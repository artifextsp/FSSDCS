-- Feria STEAM - Helpers de administración

-- Lookup de user_id por email (solo admins).
create or replace function public.admin_find_user_by_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_email is null or trim(p_email) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'user_id', v_user_id);
end;
$$;

revoke all on function public.admin_find_user_by_email(text) from public;
grant execute on function public.admin_find_user_by_email(text) to authenticated;

-- Crear evaluador buscando por email (solo admin)
create or replace function public.admin_add_evaluator_by_email(p_edition_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;
  insert into public.evaluators (user_id, edition_id, active)
  values (v_user_id, p_edition_id, true)
  on conflict (user_id, edition_id) do update set active = true
  returning id into v_id;
  return jsonb_build_object('ok', true, 'evaluator_id', v_id, 'user_id', v_user_id);
end;
$$;

revoke all on function public.admin_add_evaluator_by_email(uuid, text) from public;
grant execute on function public.admin_add_evaluator_by_email(uuid, text) to authenticated;
