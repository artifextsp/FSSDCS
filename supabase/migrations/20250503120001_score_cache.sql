-- Feria STEAM - Cache de puntajes para RLS + Realtime público

create table public.project_score_cache (
  project_id uuid primary key references public.projects (id) on delete cascade,
  edition_id uuid not null references public.editions (id) on delete cascade,
  sustentation_avg numeric(12,4) not null default 0,
  field_contest_avg numeric(12,4) not null default 0,
  total_score numeric(12,4) not null default 0,
  updated_at timestamptz not null default now()
);

create index project_score_cache_edition_idx on public.project_score_cache (edition_id);

comment on table public.project_score_cache is 'Totales agregados por proyecto: promedio de jurados por fase y suma de jornadas. Actualizado por triggers.';

-- ---------------------------------------------------------------------------
-- Cálculo: promedio de total_score por jurado, solo submitted, por fase
-- ---------------------------------------------------------------------------

create or replace function public.refresh_project_score_cache(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edition_id uuid;
  v_sust numeric(12,4);
  v_contest numeric(12,4);
begin
  select edition_id into strict v_edition_id from public.projects where id = p_project_id;

  select coalesce(avg(ev.total_score), 0) into v_sust
  from public.evaluations ev
  where ev.project_id = p_project_id
    and ev.phase = 'sustentation'
    and ev.status = 'submitted';

  select coalesce(avg(ev.total_score), 0) into v_contest
  from public.evaluations ev
  where ev.project_id = p_project_id
    and ev.phase = 'field_contest'
    and ev.status = 'submitted';

  insert into public.project_score_cache (
    project_id, edition_id, sustentation_avg, field_contest_avg, total_score, updated_at
  )
  values (
    p_project_id,
    v_edition_id,
    v_sust,
    v_contest,
    v_sust + v_contest,
    now()
  )
  on conflict (project_id) do update set
    edition_id = excluded.edition_id,
    sustentation_avg = excluded.sustentation_avg,
    field_contest_avg = excluded.field_contest_avg,
    total_score = excluded.total_score,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.refresh_project_score_cache_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  perform public.refresh_project_score_cache(pid);
  return coalesce(new, old);
end;
$$;

create trigger evaluations_refresh_score_cache
after insert or delete or update of status, total_score
on public.evaluations
for each row execute function public.refresh_project_score_cache_trigger();

-- evaluation_answers ya recalcula total_score en evaluations; al actualizar evaluation se dispara arriba.
-- Cobertura extra si hay updates directos en answers sin pasar por evaluation (no debería):
create or replace function public.refresh_project_score_cache_from_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  select ev.project_id into strict pid
  from public.evaluations ev
  where ev.id = coalesce(new.evaluation_id, old.evaluation_id);
  perform public.refresh_project_score_cache(pid);
  return coalesce(new, old);
end;
$$;

create trigger evaluation_answers_refresh_score_cache
after insert or update or delete on public.evaluation_answers
for each row execute function public.refresh_project_score_cache_from_answer();

-- ---------------------------------------------------------------------------
-- Vista de ranking (desempate alfabético por nombre de proyecto)
-- ---------------------------------------------------------------------------

create or replace view public.public_project_rankings as
select
  c.edition_id,
  c.project_id,
  p.name as project_name,
  c.sustentation_avg,
  c.field_contest_avg,
  c.total_score,
  row_number() over (
    partition by c.edition_id
    order by c.total_score desc, lower(p.name) asc, c.project_id asc
  ) as rank
from public.project_score_cache c
join public.projects p on p.id = c.project_id;

comment on view public.public_project_rankings is 'Ranking por edición: total_score DESC, nombre ASC.';

-- Vista alias para el plan maestro
create or replace view public.project_score_summary as
select
  project_id,
  edition_id,
  sustentation_avg,
  field_contest_avg,
  total_score,
  updated_at
from public.project_score_cache;

-- Fila inicial en cache al crear proyecto (ranking incluye proyectos con 0 puntos)
create or replace function public.seed_project_score_cache_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_score_cache (
    project_id, edition_id, sustentation_avg, field_contest_avg, total_score
  )
  values (new.id, new.edition_id, 0, 0, 0)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

create trigger projects_seed_score_cache
after insert on public.projects
for each row execute function public.seed_project_score_cache_row();

revoke all on function public.refresh_project_score_cache(uuid) from public;
revoke all on function public.refresh_project_score_cache_trigger() from public;
revoke all on function public.refresh_project_score_cache_from_answer() from public;
revoke all on function public.seed_project_score_cache_row() from public;
