-- Bloqueo de evaluaciones enviadas + RPC admin para reabrir
-- ---------------------------------------------------------------------------
-- Cuando una evaluación está en status='submitted' los jurados NO deben poder
-- modificarla (ni la cabecera ni las respuestas). Solo los admins pueden:
--   * editarla directamente, o
--   * reabrirla (volver a 'draft') vía admin_reopen_evaluation().
-- Las RLS existentes permiten escribir al jurado dueño en cualquier estado;
-- usamos triggers BEFORE para imponer la regla de negocio sin romper esas
-- policies (que siguen siendo necesarias para los borradores).

-- Helper: ¿el usuario actual es jurado dueño de la evaluación?
create or replace function public.is_owner_evaluator_of(p_evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.evaluations ev
      join public.evaluators e on e.id = ev.evaluator_id
     where ev.id = p_evaluation_id
       and e.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Trigger: bloquear UPDATE de evaluations cuando estaba 'submitted' y el que
-- intenta editar NO es admin. Permite que el admin transicione submitted→draft
-- (reabrir) o cualquier otro cambio.
-- ---------------------------------------------------------------------------
create or replace function public.evaluations_block_locked_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'submitted' and not public.is_admin() then
    raise exception 'Esta evaluación ya fue enviada y no puede modificarse. Pide al administrador que la reabra.'
      using errcode = 'P0001';
  end if;
  return new;
end$$;

drop trigger if exists trg_evaluations_block_locked_edit on public.evaluations;
create trigger trg_evaluations_block_locked_edit
before update on public.evaluations
for each row execute function public.evaluations_block_locked_edit();

-- ---------------------------------------------------------------------------
-- Trigger: bloquear INSERT/UPDATE/DELETE de evaluation_answers cuando la
-- evaluación padre está 'submitted' y quien escribe NO es admin.
-- ---------------------------------------------------------------------------
create or replace function public.evaluation_answers_block_locked_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_evid uuid;
begin
  if tg_op = 'DELETE' then
    v_evid := old.evaluation_id;
  else
    v_evid := new.evaluation_id;
  end if;
  select status into v_status from public.evaluations where id = v_evid;
  if v_status = 'submitted' and not public.is_admin() then
    raise exception 'La evaluación ya fue enviada. No se pueden modificar respuestas. Pide al administrador que la reabra.'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end$$;

drop trigger if exists trg_evaluation_answers_block_locked_edit on public.evaluation_answers;
create trigger trg_evaluation_answers_block_locked_edit
before insert or update or delete on public.evaluation_answers
for each row execute function public.evaluation_answers_block_locked_edit();

-- ---------------------------------------------------------------------------
-- RPC: admin_reopen_evaluation -> vuelve la evaluación a 'draft'.
-- Esto dispara el trigger evaluations_refresh_team_score y la nota deja de
-- contar para el promedio del equipo hasta que el jurado vuelva a enviarla.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reopen_evaluation(p_evaluation_id uuid)
returns public.evaluations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.evaluations;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update public.evaluations
     set status = 'draft', updated_at = now()
   where id = p_evaluation_id
   returning * into v_row;
  if not found then
    raise exception 'Evaluación no encontrada' using errcode = 'P0002';
  end if;
  return v_row;
end$$;

revoke all on function public.admin_reopen_evaluation(uuid) from public;
grant execute on function public.admin_reopen_evaluation(uuid) to authenticated;

comment on function public.admin_reopen_evaluation(uuid)
is 'Solo admins. Cambia el status de una evaluación de submitted a draft para que el jurado pueda corregirla.';
