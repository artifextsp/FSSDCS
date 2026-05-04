-- RPC atómica para activar una configuración de evaluación.
-- Antes el cliente hacía UPDATE (deactivate) seguido de INSERT (activate),
-- pero clicks rápidos o concurrencia con realtime podían violar el partial
-- unique index `evaluation_configs_one_active_per_phase` (409 Conflict).
-- Esta función lo hace en una sola transacción.

create or replace function public.admin_upsert_active_config(
  p_project_id uuid,
  p_phase public.evaluation_phase,
  p_method_type public.evaluation_method_type,
  p_scale_min numeric,
  p_scale_max numeric,
  p_config jsonb
) returns public.evaluation_configs
language plpgsql
security definer
set search_path to public
as $$
declare
  v_row public.evaluation_configs;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.evaluation_configs
     set is_active = false
   where project_id = p_project_id
     and phase = p_phase
     and is_active = true;

  insert into public.evaluation_configs (project_id, phase, method_type, scale_min, scale_max, config, is_active)
  values (p_project_id, p_phase, p_method_type, p_scale_min, p_scale_max, p_config, true)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.admin_upsert_active_config(uuid, public.evaluation_phase, public.evaluation_method_type, numeric, numeric, jsonb) to authenticated;
