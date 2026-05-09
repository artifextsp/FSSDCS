-- Columna de código secreto por equipo
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS access_code text;

-- RPC pública que valida el código y devuelve los datos del informe
-- sin revelar los nombres de los jurados (los numera por orden de puntaje)
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
  v_team       record;
  v_members    jsonb;
  v_evals      jsonb;
  v_answers    jsonb;
BEGIN
  -- Validar equipo y código
  SELECT
    t.id, t.name, t.grade_label, t.room, t.presentation_order,
    t.project_id, t.access_code,
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

  RETURN jsonb_build_object(
    'team',         jsonb_build_object(
                      'id',                 v_team.id,
                      'name',               v_team.name,
                      'grade_label',        v_team.grade_label,
                      'room',               v_team.room,
                      'presentation_order', v_team.presentation_order
                    ),
    'project_name', v_team.project_name,
    'members',      v_members,
    'evaluations',  v_evals,
    'answers',      v_answers
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_report_unlock(uuid, text) TO anon, authenticated;
