-- Feria STEAM · Extiende team_report_unlock para el informe con notas académicas
-- Agrega al payload: desglose de prototipo (func/deco/bonus), total de campo,
-- promedios de cache, ranking dentro del proyecto y la config de notas de la edición.

CREATE OR REPLACE FUNCTION public.team_report_unlock(
  p_team_id   uuid,
  p_access_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team          record;
  v_members       jsonb;
  v_evals         jsonb;
  v_answers       jsonb;
  v_round0_meta   jsonb;
  v_field_total   numeric;
  v_cache         record;
  v_project_rank  int;
  v_project_count int;
  v_grade_config  jsonb;
BEGIN
  -- Validar equipo y código
  SELECT
    t.id, t.name, t.grade_label, t.room, t.presentation_order,
    t.project_id, t.edition_id, t.access_code,
    p.name AS project_name
  INTO v_team
  FROM teams t
  JOIN projects p ON p.id = t.project_id
  WHERE t.id = p_team_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_team.access_code IS NULL OR trim(v_team.access_code) != trim(p_access_code) THEN
    RETURN jsonb_build_object('error', 'invalid_code');
  END IF;

  -- Integrantes
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('full_name', full_name, 'sort_order', sort_order)
      ORDER BY sort_order
    ), '[]'::jsonb
  ) INTO v_members
  FROM team_members
  WHERE team_id = p_team_id;

  -- Evaluaciones enviadas (ordenadas por puntaje desc para numerarlas consistentemente)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', id, 'total_score', total_score, 'phase', phase)
      ORDER BY total_score DESC NULLS LAST
    ), '[]'::jsonb
  ) INTO v_evals
  FROM evaluations
  WHERE team_id = p_team_id AND status = 'submitted';

  -- Respuestas con observaciones de esas evaluaciones
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'evaluation_id', ea.evaluation_id,
        'item_key',      ea.item_key,
        'observation',   ea.observation,
        'score',         ea.score
      )
    ), '[]'::jsonb
  ) INTO v_answers
  FROM evaluation_answers ea
  WHERE ea.evaluation_id IN (
    SELECT id FROM evaluations
    WHERE team_id = p_team_id AND status = 'submitted'
  )
  AND ea.observation IS NOT NULL
  AND trim(ea.observation) != '';

  -- Prototipo + Bonus (ronda 0) de la competencia del proyecto
  SELECT fr.meta
  INTO v_round0_meta
  FROM field_results fr
  JOIN field_rounds rd ON rd.id = fr.round_id
  JOIN field_competitions fc ON fc.id = rd.competition_id
  WHERE fr.team_id = p_team_id
    AND rd.round_number = 0
    AND fc.project_id = v_team.project_id
  LIMIT 1;

  -- Total de campo (suma de todas las rondas) del equipo
  SELECT COALESCE(SUM(fr.computed_points), 0)
  INTO v_field_total
  FROM field_results fr
  JOIN field_rounds rd ON rd.id = fr.round_id
  JOIN field_competitions fc ON fc.id = rd.competition_id
  WHERE fr.team_id = p_team_id
    AND fc.project_id = v_team.project_id;

  -- Cache de puntajes
  SELECT sustentation_avg, field_contest_avg, total_score
  INTO v_cache
  FROM team_score_cache
  WHERE team_id = p_team_id;

  -- Ranking dentro del proyecto y cantidad de equipos del proyecto
  SELECT project_rank INTO v_project_rank
  FROM public_team_rankings
  WHERE team_id = p_team_id;

  SELECT count(*) INTO v_project_count
  FROM public_team_rankings
  WHERE project_id = v_team.project_id;

  -- Config de notas de la edición
  SELECT config INTO v_grade_config
  FROM grade_report_configs
  WHERE edition_id = v_team.edition_id;

  RETURN jsonb_build_object(
    'team',         jsonb_build_object(
                      'id',                 v_team.id,
                      'name',               v_team.name,
                      'grade_label',        v_team.grade_label,
                      'room',               v_team.room,
                      'presentation_order', v_team.presentation_order,
                      'project_id',         v_team.project_id,
                      'edition_id',         v_team.edition_id
                    ),
    'project_name', v_team.project_name,
    'members',      v_members,
    'evaluations',  v_evals,
    'answers',      v_answers,
    'funcionalidad', CASE WHEN v_round0_meta ? 'funcionalidad' THEN (v_round0_meta->>'funcionalidad')::numeric ELSE NULL END,
    'decoracion',    CASE WHEN v_round0_meta ? 'decoracion' THEN (v_round0_meta->>'decoracion')::numeric ELSE NULL END,
    'bonus',         CASE WHEN v_round0_meta ? 'bonus' THEN (v_round0_meta->>'bonus')::numeric ELSE NULL END,
    'field_contest_total', COALESCE(v_field_total, 0),
    'sustentation_avg',    COALESCE(v_cache.sustentation_avg, 0),
    'field_contest_avg',   COALESCE(v_cache.field_contest_avg, 0),
    'total_score',         COALESCE(v_cache.total_score, 0),
    'project_rank',        v_project_rank,
    'project_team_count',  v_project_count,
    'grade_config',        v_grade_config
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_report_unlock(uuid, text) TO anon, authenticated;
