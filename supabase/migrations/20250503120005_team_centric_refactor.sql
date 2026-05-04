-- Feria STEAM · Refactor a modelo 1 proyecto = N equipos
-- - Permite múltiples equipos por proyecto
-- - Mueve room/presentation_order del proyecto al equipo
-- - Re-asocia evaluaciones y fotos al equipo
-- - Recrea cache de puntajes y vistas a nivel equipo

-- 1. Permitir N equipos por proyecto
alter table public.teams drop constraint if exists teams_project_id_key;

-- 2. Campos por equipo
alter table public.teams
  add column if not exists room text,
  add column if not exists presentation_order int,
  add column if not exists description text,
  add column if not exists grade_label text;

-- 3. Backfill: copiar room/orden del proyecto al equipo cuando estén
do $$
declare has_room boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='projects' and column_name='room'
  ) into has_room;
  if has_room then
    update public.teams t
       set room = p.room,
           presentation_order = p.presentation_order
      from public.projects p
     where t.project_id = p.id
       and t.room is null
       and t.presentation_order is null;
    alter table public.projects drop column if exists room;
    alter table public.projects drop column if exists presentation_order;
  end if;
end$$;

-- 4. Evaluaciones: ahora por equipo
alter table public.evaluations
  add column if not exists team_id uuid references public.teams(id) on delete cascade;

-- 5. Backfill: mapear cada evaluación al primer equipo del proyecto
update public.evaluations e
   set team_id = sub.tid
  from (
    select e2.id,
           (select t.id from public.teams t where t.project_id = e2.project_id order by t.created_at asc limit 1) as tid
      from public.evaluations e2
     where e2.team_id is null
  ) sub
 where sub.id = e.id;

-- 6. Sustituir unique(project_id, evaluator_id, evaluation_config_id) por (team_id, ...)
alter table public.evaluations
  drop constraint if exists evaluations_project_id_evaluator_id_evaluation_config_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'evaluations_team_eval_unique'
  ) then
    alter table public.evaluations
      add constraint evaluations_team_eval_unique unique (team_id, evaluator_id, evaluation_config_id);
  end if;
end$$;

-- 7. Eliminar cache antiguo y vistas de proyecto
drop view if exists public.public_project_rankings;
drop view if exists public.project_score_summary;
drop trigger if exists evaluations_refresh_score_cache on public.evaluations;
drop trigger if exists evaluation_answers_refresh_score_cache on public.evaluation_answers;
drop trigger if exists projects_seed_score_cache on public.projects;
drop function if exists public.refresh_project_score_cache(uuid);
drop function if exists public.refresh_project_score_cache_trigger();
drop function if exists public.refresh_project_score_cache_from_answer();
drop function if exists public.seed_project_score_cache_row();
drop table if exists public.project_score_cache cascade;

-- 8. Cache de puntajes por equipo
create table if not exists public.team_score_cache (
  team_id uuid primary key references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  sustentation_avg numeric(12,4) not null default 0,
  field_contest_avg numeric(12,4) not null default 0,
  total_score numeric(12,4) not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists team_score_cache_project_idx on public.team_score_cache(project_id);
create index if not exists team_score_cache_edition_idx on public.team_score_cache(edition_id);

-- 9. Funciones y triggers de refresco
create or replace function public.refresh_team_score_cache(p_team_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project_id uuid;
  v_edition_id uuid;
  v_sust numeric(12,4);
  v_field numeric(12,4);
begin
  if p_team_id is null then return; end if;
  select t.project_id, p.edition_id
    into v_project_id, v_edition_id
    from public.teams t
    join public.projects p on p.id = t.project_id
   where t.id = p_team_id;
  if v_project_id is null then return; end if;

  select coalesce(avg(ev.total_score), 0) into v_sust
    from public.evaluations ev
   where ev.team_id = p_team_id and ev.phase = 'sustentation' and ev.status = 'submitted';

  select coalesce(avg(ev.total_score), 0) into v_field
    from public.evaluations ev
   where ev.team_id = p_team_id and ev.phase = 'field_contest' and ev.status = 'submitted';

  insert into public.team_score_cache (team_id, project_id, edition_id, sustentation_avg, field_contest_avg, total_score, updated_at)
  values (p_team_id, v_project_id, v_edition_id, v_sust, v_field, v_sust + v_field, now())
  on conflict (team_id) do update set
    project_id = excluded.project_id,
    edition_id = excluded.edition_id,
    sustentation_avg = excluded.sustentation_avg,
    field_contest_avg = excluded.field_contest_avg,
    total_score = excluded.total_score,
    updated_at = excluded.updated_at;
end$$;

create or replace function public.refresh_team_score_cache_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (TG_OP = 'DELETE') then
    perform public.refresh_team_score_cache(old.team_id);
  else
    perform public.refresh_team_score_cache(new.team_id);
    if (TG_OP = 'UPDATE' and old.team_id is distinct from new.team_id) then
      perform public.refresh_team_score_cache(old.team_id);
    end if;
  end if;
  return coalesce(new, old);
end$$;

create trigger evaluations_refresh_team_score
after insert or delete or update of status, total_score, team_id
on public.evaluations
for each row execute function public.refresh_team_score_cache_trigger();

create or replace function public.refresh_team_score_cache_from_answer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_team_id uuid;
begin
  select team_id into v_team_id
    from public.evaluations
   where id = coalesce(new.evaluation_id, old.evaluation_id);
  if v_team_id is not null then perform public.refresh_team_score_cache(v_team_id); end if;
  return coalesce(new, old);
end$$;

create trigger evaluation_answers_refresh_team_score
after insert or update or delete on public.evaluation_answers
for each row execute function public.refresh_team_score_cache_from_answer();

create or replace function public.seed_team_score_cache_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_edition_id uuid;
begin
  select edition_id into v_edition_id from public.projects where id = new.project_id;
  insert into public.team_score_cache (team_id, project_id, edition_id, sustentation_avg, field_contest_avg, total_score)
  values (new.id, new.project_id, v_edition_id, 0, 0, 0)
  on conflict (team_id) do nothing;
  return new;
end$$;

create trigger teams_seed_score_cache
after insert on public.teams
for each row execute function public.seed_team_score_cache_row();

-- Backfill cache para los equipos existentes
insert into public.team_score_cache (team_id, project_id, edition_id, sustentation_avg, field_contest_avg, total_score)
select t.id, t.project_id, p.edition_id, 0, 0, 0
  from public.teams t
  join public.projects p on p.id = t.project_id
on conflict (team_id) do nothing;

-- Recalcular puntajes existentes
do $$
declare r record;
begin
  for r in select id from public.teams loop
    perform public.refresh_team_score_cache(r.id);
  end loop;
end$$;

-- 10. Vista de ranking por equipo (con ranking dentro de edición y dentro de proyecto)
create or replace view public.public_team_rankings as
select
  c.team_id,
  c.project_id,
  c.edition_id,
  t.name as team_name,
  p.name as project_name,
  t.grade_label as team_grade_label,
  p.grade_label as project_grade_label,
  t.room,
  t.presentation_order,
  c.sustentation_avg,
  c.field_contest_avg,
  c.total_score,
  row_number() over (
    partition by c.edition_id
    order by c.total_score desc, lower(t.name) asc, c.team_id asc
  ) as edition_rank,
  row_number() over (
    partition by c.project_id
    order by c.total_score desc, lower(t.name) asc, c.team_id asc
  ) as project_rank
from public.team_score_cache c
join public.teams t on t.id = c.team_id
join public.projects p on p.id = c.project_id;

-- 11. RLS de team_score_cache
alter table public.team_score_cache enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_select_admin') then
    create policy team_score_cache_select_admin on public.team_score_cache for select using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_select_assigned') then
    create policy team_score_cache_select_assigned on public.team_score_cache for select using (public.is_assigned_evaluator(project_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_select_viewer') then
    create policy team_score_cache_select_viewer on public.team_score_cache for select using (public.is_public_viewer_of_edition(edition_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_select_public_open') then
    create policy team_score_cache_select_public_open on public.team_score_cache for select using (
      exists (select 1 from public.editions ed where ed.id = team_score_cache.edition_id and ed.public_results_visible = true)
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_write_admin') then
    create policy team_score_cache_write_admin on public.team_score_cache for all using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_trigger_insert') then
    create policy team_score_cache_trigger_insert on public.team_score_cache for insert with check (pg_trigger_depth() > 0);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_trigger_update') then
    create policy team_score_cache_trigger_update on public.team_score_cache for update using (pg_trigger_depth() > 0) with check (pg_trigger_depth() > 0);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_score_cache' and policyname='team_score_cache_trigger_delete') then
    create policy team_score_cache_trigger_delete on public.team_score_cache for delete using (pg_trigger_depth() > 0);
  end if;
end$$;

grant select on public.team_score_cache to anon, authenticated;
grant select on public.public_team_rankings to anon, authenticated;

-- 12. Fotos: ahora por equipo (drop policies viejas, agrega team_id, rename)
-- 12.a) Drop policies viejas que referencian project_id (en project_photos y storage.objects)
do $$
declare r record;
begin
  -- Policies en project_photos (si la tabla aún existe)
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='project_photos') then
    for r in select policyname from pg_policies where schemaname='public' and tablename='project_photos' loop
      execute format('drop policy if exists %I on public.project_photos', r.policyname);
    end loop;
  end if;
end$$;

-- Policies en storage.objects relacionadas con fotos
drop policy if exists project_photos_objects_select on storage.objects;
drop policy if exists project_photos_objects_insert on storage.objects;
drop policy if exists project_photos_objects_update on storage.objects;
drop policy if exists project_photos_objects_delete on storage.objects;

-- 12.b) Refactor estructura
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='project_photos') then
    alter table public.project_photos add column if not exists team_id uuid references public.teams(id) on delete cascade;
    update public.project_photos ph
       set team_id = (select t.id from public.teams t where t.project_id = ph.project_id order by t.created_at asc limit 1)
     where team_id is null and exists (select 1 from public.teams t where t.project_id = ph.project_id);
    delete from public.project_photos where team_id is null;
    alter table public.project_photos alter column team_id set not null;
    alter table public.project_photos drop column if exists project_id;
    alter table public.project_photos rename to team_photos;
  end if;
end$$;

drop index if exists project_photos_project_idx;
create index if not exists team_photos_team_idx on public.team_photos(team_id);

-- 12.c) Limpieza por si quedan policies del rename con nombres viejos
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='team_photos' loop
    execute format('drop policy if exists %I on public.team_photos', r.policyname);
  end loop;
end$$;

alter table public.team_photos enable row level security;

create policy team_photos_select_privileged on public.team_photos for select
using (
  public.is_admin()
  or exists (
    select 1 from public.teams t
    join public.projects p on p.id = t.project_id
    where t.id = team_photos.team_id
      and (
        public.is_assigned_evaluator(t.project_id)
        or public.is_public_viewer_of_edition(p.edition_id)
        or exists (
          select 1 from public.editions ed
          where ed.id = p.edition_id and ed.public_results_visible = true
        )
      )
  )
);

create policy team_photos_write_admin on public.team_photos for all
using (public.is_admin()) with check (public.is_admin());

create policy team_photos_insert_evaluator on public.team_photos for insert
with check (
  exists (
    select 1 from public.teams t
    where t.id = team_photos.team_id
      and public.is_assigned_evaluator(t.project_id)
  )
  and (uploaded_by is null or uploaded_by = auth.uid())
);

create policy team_photos_update_evaluator on public.team_photos for update
using (
  exists (
    select 1 from public.teams t
    where t.id = team_photos.team_id
      and public.is_assigned_evaluator(t.project_id)
  )
);

create policy team_photos_delete_evaluator on public.team_photos for delete
using (
  exists (
    select 1 from public.teams t
    where t.id = team_photos.team_id
      and public.is_assigned_evaluator(t.project_id)
  )
);

-- 13. Storage policies: convención de ruta {team_id}/...
drop policy if exists project_documents_objects_select on storage.objects;
drop policy if exists project_documents_objects_insert_admin on storage.objects;
drop policy if exists project_documents_objects_mutate_admin on storage.objects;
drop policy if exists project_documents_objects_delete_admin on storage.objects;

create policy team_photos_objects_select on storage.objects for select
to authenticated, anon
using (
  bucket_id = 'project-photos'
  and exists (
    select 1 from public.team_photos ph
    where ph.storage_path = storage.objects.name
      and (
        public.is_admin()
        or exists (
          select 1 from public.teams t
          join public.projects p on p.id = t.project_id
          where t.id = ph.team_id
            and (
              public.is_assigned_evaluator(t.project_id)
              or public.is_public_viewer_of_edition(p.edition_id)
              or exists (
                select 1 from public.editions ed
                where ed.id = p.edition_id and ed.public_results_visible = true
              )
            )
        )
      )
  )
);

create policy team_photos_objects_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1 from public.teams t
        where t.id = (split_part(name, '/', 1))::uuid
          and public.is_assigned_evaluator(t.project_id)
      )
    )
  )
);

create policy team_photos_objects_update on storage.objects for update
to authenticated
using (
  bucket_id = 'project-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1 from public.teams t
        where t.id = (split_part(name, '/', 1))::uuid
          and public.is_assigned_evaluator(t.project_id)
      )
    )
  )
);

create policy team_photos_objects_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1 from public.teams t
        where t.id = (split_part(name, '/', 1))::uuid
          and public.is_assigned_evaluator(t.project_id)
      )
    )
  )
);

create policy project_docs_objects_select on storage.objects for select
to authenticated, anon
using (
  bucket_id = 'project-documents'
  and exists (
    select 1 from public.project_documents d
    where d.storage_path = storage.objects.name
      and (
        public.is_admin()
        or public.is_assigned_evaluator(d.project_id)
        or public.is_public_viewer_of_edition(
          (select edition_id from public.projects p where p.id = d.project_id)
        )
        or exists (
          select 1 from public.projects p
          join public.editions e on e.id = p.edition_id
          where p.id = d.project_id and e.public_results_visible = true
        )
      )
  )
);

create policy project_docs_objects_admin_all on storage.objects for all
to authenticated
using (bucket_id = 'project-documents' and public.is_admin())
with check (bucket_id = 'project-documents' and public.is_admin());

-- 14. Realtime: agregar team_score_cache y team_photos
do $$
begin
  begin
    execute 'alter publication supabase_realtime drop table public.project_score_cache';
  exception when others then null; end;
  begin
    execute 'alter publication supabase_realtime drop table public.project_photos';
  exception when others then null; end;
  begin
    execute 'alter publication supabase_realtime add table public.team_score_cache';
  exception when duplicate_object then null; end;
  begin
    execute 'alter publication supabase_realtime add table public.team_photos';
  exception when duplicate_object then null; end;
  begin
    execute 'alter publication supabase_realtime add table public.teams';
  exception when duplicate_object then null; end;
end$$;

-- 15. Reemplazar team_portal_lookup
create or replace function public.team_portal_lookup(p_edition_slug text, p_team_name text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_edition public.editions%rowtype;
  v_team public.teams%rowtype;
  v_project public.projects%rowtype;
  v_members jsonb;
  v_docs jsonb;
  v_photos jsonb;
  v_scores jsonb;
  v_project_rank int;
  v_edition_rank int;
begin
  if p_edition_slug is null or trim(p_edition_slug) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_edition_slug');
  end if;
  if p_team_name is null or trim(p_team_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_name');
  end if;

  select * into v_edition from public.editions e where e.slug = trim(p_edition_slug) limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'edition_not_found'); end if;

  select t.* into v_team
    from public.teams t
   where t.edition_id = v_edition.id
     and t.name_normalized = lower(trim(p_team_name))
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'team_not_found'); end if;

  select * into v_project from public.projects p where p.id = v_team.project_id;

  select coalesce(jsonb_agg(to_jsonb(tm) order by tm.sort_order, tm.created_at), '[]'::jsonb)
    into v_members
    from public.team_members tm
   where tm.team_id = v_team.id;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.sort_order, d.created_at), '[]'::jsonb)
    into v_docs
    from public.project_documents d
   where d.project_id = v_project.id;

  select coalesce(jsonb_agg(to_jsonb(ph) order by ph.created_at), '[]'::jsonb)
    into v_photos
    from public.team_photos ph
   where ph.team_id = v_team.id;

  select coalesce(
    (select to_jsonb(c) - 'team_id' - 'project_id' - 'edition_id' from public.team_score_cache c where c.team_id = v_team.id),
    jsonb_build_object('sustentation_avg', 0, 'field_contest_avg', 0, 'total_score', 0, 'updated_at', null)
  ) into v_scores;

  select edition_rank, project_rank into v_edition_rank, v_project_rank
    from public.public_team_rankings r where r.team_id = v_team.id limit 1;

  return jsonb_build_object(
    'ok', true,
    'edition', jsonb_build_object(
      'id', v_edition.id, 'slug', v_edition.slug, 'name', v_edition.name,
      'year', v_edition.year, 'status', v_edition.status,
      'public_results_visible', v_edition.public_results_visible
    ),
    'project', to_jsonb(v_project),
    'team', to_jsonb(v_team),
    'members', v_members,
    'documents', v_docs,
    'photos', v_photos,
    'scores', v_scores,
    'edition_rank', to_jsonb(v_edition_rank),
    'project_rank', to_jsonb(v_project_rank)
  );
end$$;
