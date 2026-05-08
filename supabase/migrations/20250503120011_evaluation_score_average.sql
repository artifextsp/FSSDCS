-- recalc_evaluation_total ahora calcula el PROMEDIO de las respuestas no nulas
-- (en lugar de la suma). Esto garantiza que el total de cada jurado quede
-- siempre dentro de la escala configurada (scale_min..scale_max), y por lo
-- tanto que el avg-de-jurados (team_score_cache.sustentation_avg /
-- field_contest_avg) tambien respete esa escala.
--
-- Edge cases:
--   * AVG(score) ignora NULLs (preguntas sin contestar): no se promedia por 0.
--   * Si no hay respuestas: total = 0.

create or replace function public.recalc_evaluation_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  eid uuid;
  s numeric(12,4);
begin
  eid := coalesce(new.evaluation_id, old.evaluation_id);
  select coalesce(avg(score), 0) into s
    from public.evaluation_answers
   where evaluation_id = eid
     and score is not null;
  update public.evaluations set total_score = s where id = eid;
  return coalesce(new, old);
end;
$function$;

-- Recalculo retroactivo de todas las evaluaciones existentes para que el
-- ranking se reconstruya con la nueva formula. El UPDATE dispara
-- evaluations_refresh_team_score que actualiza team_score_cache.
update public.evaluations ev
   set total_score = sub.avg_score
  from (
    select evaluation_id, coalesce(avg(score), 0) as avg_score
      from public.evaluation_answers
     where score is not null
     group by evaluation_id
  ) sub
 where ev.id = sub.evaluation_id;

-- Las evaluaciones SIN ninguna respuesta deberian quedar en 0 explicitamente.
update public.evaluations ev
   set total_score = 0
 where not exists (
   select 1 from public.evaluation_answers a
    where a.evaluation_id = ev.id and a.score is not null
 ) and ev.total_score <> 0;
