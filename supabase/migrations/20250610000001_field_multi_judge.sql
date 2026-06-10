-- Feria STEAM · Multi-juez para competencias de campo
-- Permite asignar múltiples jueces a una misma competencia.

-- 1. Tabla intermedia
CREATE TABLE public.field_competition_judges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.field_competitions(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES public.evaluators(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, evaluator_id)
);

CREATE INDEX fcj_competition_idx ON public.field_competition_judges(competition_id);
CREATE INDEX fcj_evaluator_idx ON public.field_competition_judges(evaluator_id);

-- 2. Migrar dato existente: si assigned_evaluator_id tiene valor, crear fila en la nueva tabla
INSERT INTO public.field_competition_judges (competition_id, evaluator_id)
SELECT id, assigned_evaluator_id FROM public.field_competitions
WHERE assigned_evaluator_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Actualizar helper is_field_judge para revisar la nueva tabla
CREATE OR REPLACE FUNCTION public.is_field_judge(p_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.field_competition_judges fcj
      JOIN public.evaluators e ON e.id = fcj.evaluator_id
     WHERE fcj.competition_id = p_competition_id
       AND e.user_id = auth.uid()
  );
$$;

-- 4. RLS para la nueva tabla
ALTER TABLE public.field_competition_judges ENABLE ROW LEVEL SECURITY;

CREATE POLICY fcj_select_admin ON public.field_competition_judges FOR SELECT
  USING (public.is_admin());

CREATE POLICY fcj_select_judge ON public.field_competition_judges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.evaluators e
       WHERE e.id = field_competition_judges.evaluator_id
         AND e.user_id = auth.uid()
    )
  );

CREATE POLICY fcj_write_admin ON public.field_competition_judges FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5. Grants
GRANT SELECT ON public.field_competition_judges TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.field_competition_judges TO authenticated;

-- 6. Realtime
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.field_competition_judges';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;
