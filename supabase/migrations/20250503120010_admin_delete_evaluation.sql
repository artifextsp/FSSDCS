-- RPC para que un admin elimine completamente una evaluación (header +
-- respuestas via cascade). Sirve para limpiar pruebas o casos en los que
-- un jurado calificó por error y queremos partir desde cero.
-- El trigger after-delete refresh_team_score_cache_trigger se encarga de
-- recalcular el cache del equipo automáticamente.

create or replace function public.admin_delete_evaluation(p_evaluation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  delete from public.evaluations where id = p_evaluation_id;
  if not found then
    raise exception 'Evaluación no encontrada' using errcode = 'P0002';
  end if;
end$$;

revoke all on function public.admin_delete_evaluation(uuid) from public;
grant execute on function public.admin_delete_evaluation(uuid) to authenticated;

comment on function public.admin_delete_evaluation(uuid)
is 'Solo admins. Elimina la evaluación (cabecera + respuestas) y recalcula el ranking.';
