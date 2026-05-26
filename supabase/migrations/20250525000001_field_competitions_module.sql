-- Feria STEAM · Módulo de Pruebas de Campo
-- Tablas: field_competitions, field_rounds, field_results
-- Trigger: actualiza team_score_cache.field_contest_avg automáticamente

-- ---------------------------------------------------------------------------
-- 1. Enum de tipos de competencia
-- ---------------------------------------------------------------------------

CREATE TYPE public.field_competition_type AS ENUM (
  'time_trial',       -- Menor tiempo → posición → puntos por puesto
  'performance',      -- Puntos acumulables por eventos/criterios
  'combat',           -- Victoria/empate/derrota entre pares
  'elimination',      -- Rondas progresivas, eliminados conservan puntos
  'timed_quantity'    -- Mover N objetos en menor tiempo, por rondas
);

CREATE TYPE public.field_competition_status AS ENUM (
  'setup',     -- En configuración, no visible para el juez
  'active',    -- En curso, el juez puede registrar resultados
  'finished'   -- Terminada, solo lectura
);

-- ---------------------------------------------------------------------------
-- 2. Competencias de campo (1 por proyecto)
-- ---------------------------------------------------------------------------

CREATE TABLE public.field_competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  edition_id uuid NOT NULL REFERENCES public.editions(id) ON DELETE CASCADE,
  competition_type public.field_competition_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.field_competition_status NOT NULL DEFAULT 'setup',
  assigned_evaluator_id uuid REFERENCES public.evaluators(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE INDEX field_competitions_edition_idx ON public.field_competitions(edition_id);

CREATE TRIGGER field_competitions_set_updated_at
BEFORE UPDATE ON public.field_competitions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.field_competitions IS
  'Una competencia de campo por proyecto. El admin configura tipo y reglas; el juez registra resultados.';

-- ---------------------------------------------------------------------------
-- 3. Rondas (dinámicas, el juez agrega sobre la marcha)
-- ---------------------------------------------------------------------------

CREATE TABLE public.field_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.field_competitions(id) ON DELETE CASCADE,
  round_number int NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, round_number)
);

CREATE INDEX field_rounds_competition_idx ON public.field_rounds(competition_id);

COMMENT ON TABLE public.field_rounds IS
  'Rondas de una competencia. Se agregan dinámicamente durante el evento.';

-- ---------------------------------------------------------------------------
-- 4. Resultados (1 por equipo × ronda)
-- ---------------------------------------------------------------------------

CREATE TABLE public.field_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.field_rounds(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  raw_value numeric(12,4),
  computed_points numeric(12,4) NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, team_id)
);

CREATE INDEX field_results_round_idx ON public.field_results(round_id);
CREATE INDEX field_results_team_idx ON public.field_results(team_id);

CREATE TRIGGER field_results_set_updated_at
BEFORE UPDATE ON public.field_results
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.field_results IS
  'Resultado de un equipo en una ronda. raw_value es lo medido; computed_points es lo que suma al ranking.';

-- ---------------------------------------------------------------------------
-- 5. Trigger: field_results → team_score_cache.field_contest_avg
--    Suma todos los computed_points de un equipo en su competencia de campo
--    y lo escribe como field_contest_avg.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_field_score_for_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric(12,4);
BEGIN
  IF p_team_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(fr.computed_points), 0)
    INTO v_total
    FROM public.field_results fr
    JOIN public.field_rounds rd ON rd.id = fr.round_id
    JOIN public.field_competitions fc ON fc.id = rd.competition_id
    WHERE fr.team_id = p_team_id;

  UPDATE public.team_score_cache
     SET field_contest_avg = v_total,
         total_score = sustentation_avg + v_total,
         updated_at = now()
   WHERE team_id = p_team_id;

  IF NOT FOUND THEN
    INSERT INTO public.team_score_cache (team_id, project_id, edition_id, sustentation_avg, field_contest_avg, total_score)
    SELECT p_team_id, t.project_id, p.edition_id, 0, v_total, v_total
      FROM public.teams t
      JOIN public.projects p ON p.id = t.project_id
     WHERE t.id = p_team_id
    ON CONFLICT (team_id) DO UPDATE SET
      field_contest_avg = v_total,
      total_score = team_score_cache.sustentation_avg + v_total,
      updated_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_results_refresh_score_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM public.refresh_field_score_for_team(OLD.team_id);
  ELSE
    PERFORM public.refresh_field_score_for_team(NEW.team_id);
    IF (TG_OP = 'UPDATE' AND OLD.team_id IS DISTINCT FROM NEW.team_id) THEN
      PERFORM public.refresh_field_score_for_team(OLD.team_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER field_results_refresh_score
AFTER INSERT OR UPDATE OR DELETE ON public.field_results
FOR EACH ROW EXECUTE FUNCTION public.field_results_refresh_score_trigger();

-- Al borrar una ronda entera también se refrescan los equipos afectados
CREATE OR REPLACE FUNCTION public.field_round_delete_refresh_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT team_id FROM public.field_results WHERE round_id = OLD.id LOOP
    PERFORM public.refresh_field_score_for_team(r.team_id);
  END LOOP;
  RETURN OLD;
END;
$$;

CREATE TRIGGER field_rounds_before_delete_refresh
BEFORE DELETE ON public.field_rounds
FOR EACH ROW EXECUTE FUNCTION public.field_round_delete_refresh_trigger();

-- ---------------------------------------------------------------------------
-- 6. Helper: ¿es el juez asignado a esta competencia?
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_field_judge(p_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.field_competitions fc
      JOIN public.evaluators e ON e.id = fc.assigned_evaluator_id
     WHERE fc.id = p_competition_id
       AND e.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.field_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_results ENABLE ROW LEVEL SECURITY;

-- field_competitions: lectura
CREATE POLICY fc_select_admin ON public.field_competitions FOR SELECT
  USING (public.is_admin());

CREATE POLICY fc_select_judge ON public.field_competitions FOR SELECT
  USING (public.is_field_judge(id));

CREATE POLICY fc_select_public ON public.field_competitions FOR SELECT
  USING (
    status IN ('active', 'finished')
    AND EXISTS (
      SELECT 1 FROM public.editions ed
       WHERE ed.id = field_competitions.edition_id
         AND (ed.public_results_visible = true OR ed.status = 'active')
    )
  );

-- field_competitions: escritura solo admin
CREATE POLICY fc_write_admin ON public.field_competitions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- field_rounds: lectura
CREATE POLICY fr_select_admin ON public.field_rounds FOR SELECT
  USING (public.is_admin());

CREATE POLICY fr_select_judge ON public.field_rounds FOR SELECT
  USING (public.is_field_judge(competition_id));

CREATE POLICY fr_select_public ON public.field_rounds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.field_competitions fc
       WHERE fc.id = field_rounds.competition_id
         AND fc.status IN ('active', 'finished')
         AND EXISTS (
           SELECT 1 FROM public.editions ed
            WHERE ed.id = fc.edition_id
              AND (ed.public_results_visible = true OR ed.status = 'active')
         )
    )
  );

-- field_rounds: escritura admin + juez asignado
CREATE POLICY fr_write_admin ON public.field_rounds FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY fr_insert_judge ON public.field_rounds FOR INSERT
  WITH CHECK (public.is_field_judge(competition_id));

CREATE POLICY fr_delete_judge ON public.field_rounds FOR DELETE
  USING (public.is_field_judge(competition_id));

-- field_results: lectura
CREATE POLICY fres_select_admin ON public.field_results FOR SELECT
  USING (public.is_admin());

CREATE POLICY fres_select_judge ON public.field_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.field_rounds rd
       WHERE rd.id = field_results.round_id
         AND public.is_field_judge(rd.competition_id)
    )
  );

CREATE POLICY fres_select_public ON public.field_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.field_rounds rd
      JOIN public.field_competitions fc ON fc.id = rd.competition_id
      WHERE rd.id = field_results.round_id
        AND fc.status IN ('active', 'finished')
        AND EXISTS (
          SELECT 1 FROM public.editions ed
           WHERE ed.id = fc.edition_id
             AND (ed.public_results_visible = true OR ed.status = 'active')
        )
    )
  );

-- field_results: escritura admin + juez asignado
CREATE POLICY fres_write_admin ON public.field_results FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY fres_insert_judge ON public.field_results FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.field_rounds rd
       WHERE rd.id = field_results.round_id
         AND public.is_field_judge(rd.competition_id)
    )
  );

CREATE POLICY fres_update_judge ON public.field_results FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.field_rounds rd
       WHERE rd.id = field_results.round_id
         AND public.is_field_judge(rd.competition_id)
    )
  );

CREATE POLICY fres_delete_judge ON public.field_results FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.field_rounds rd
       WHERE rd.id = field_results.round_id
         AND public.is_field_judge(rd.competition_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Permisos y Realtime
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.field_competitions TO anon, authenticated;
GRANT SELECT ON public.field_rounds TO anon, authenticated;
GRANT SELECT ON public.field_results TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON public.field_competitions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.field_rounds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.field_results TO authenticated;

-- Realtime para actualizaciones en vivo
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.field_competitions';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.field_rounds';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.field_results';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;

-- Revocar ejecución directa de funciones internas
REVOKE ALL ON FUNCTION public.refresh_field_score_for_team(uuid) FROM public;
REVOKE ALL ON FUNCTION public.field_results_refresh_score_trigger() FROM public;
REVOKE ALL ON FUNCTION public.field_round_delete_refresh_trigger() FROM public;
