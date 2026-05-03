-- Feria STEAM - RLS, helpers y RPC para portal de equipos (sin auth)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_public_viewer_of_edition(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.viewer_editions ve
    where ve.user_id = auth.uid() and ve.edition_id = p_edition_id
  );
$$;

create or replace function public.is_evaluator_of_edition(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.evaluators e
    where e.user_id = auth.uid() and e.edition_id = p_edition_id and e.active = true
  );
$$;

create or replace function public.evaluator_id_for_edition(p_edition_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id from public.evaluators e
  where e.user_id = auth.uid() and e.edition_id = p_edition_id and e.active = true
  limit 1;
$$;

create or replace function public.is_assigned_evaluator(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_evaluator_assignments pea
    join public.evaluators e on e.id = pea.evaluator_id
    join public.projects pr on pr.id = pea.project_id
    where pea.project_id = p_project_id
      and e.user_id = auth.uid()
      and e.active = true
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: portal de equipo por nombre (sin contraseña) — evita filtrar toda la tabla
-- ---------------------------------------------------------------------------

create or replace function public.team_portal_lookup(p_edition_slug text, p_team_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_edition public.editions%rowtype;
  v_team public.teams%rowtype;
  v_project public.projects%rowtype;
  v_members jsonb;
  v_docs jsonb;
  v_photos jsonb;
  v_scores jsonb;
  v_rank bigint;
begin
  if p_edition_slug is null or trim(p_edition_slug) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_edition_slug');
  end if;
  if p_team_name is null or trim(p_team_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_name');
  end if;

  select * into v_edition from public.editions e where e.slug = trim(p_edition_slug) limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'edition_not_found');
  end if;

  select t.* into v_team
  from public.teams t
  where t.edition_id = v_edition.id
    and t.name_normalized = lower(trim(p_team_name))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

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
  from public.project_photos ph
  where ph.project_id = v_project.id;

  select coalesce(
    (
      select to_jsonb(c) - 'project_id' - 'edition_id'
      from public.project_score_cache c
      where c.project_id = v_project.id
    ),
    jsonb_build_object(
      'sustentation_avg', 0,
      'field_contest_avg', 0,
      'total_score', 0,
      'updated_at', null
    )
  )
  into v_scores;

  select r.rank into v_rank
  from public.public_project_rankings r
  where r.project_id = v_project.id
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'edition', jsonb_build_object(
      'id', v_edition.id,
      'slug', v_edition.slug,
      'name', v_edition.name,
      'year', v_edition.year,
      'status', v_edition.status,
      'public_results_visible', v_edition.public_results_visible
    ),
    'project', to_jsonb(v_project),
    'team', to_jsonb(v_team),
    'members', v_members,
    'documents', v_docs,
    'photos', v_photos,
    'scores', v_scores,
    'rank', to_jsonb(v_rank)
  );
end;
$$;

comment on function public.team_portal_lookup is 'Lookup seguro por slug de edición y nombre de equipo (normalizado).';

grant execute on function public.team_portal_lookup(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Habilitar RLS
-- ---------------------------------------------------------------------------

alter table public.editions enable row level security;
alter table public.profiles enable row level security;
alter table public.viewer_editions enable row level security;
alter table public.projects enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.evaluators enable row level security;
alter table public.project_evaluator_assignments enable row level security;
alter table public.project_documents enable row level security;
alter table public.project_photos enable row level security;
alter table public.evaluation_configs enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_answers enable row level security;
alter table public.project_score_cache enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy profiles_select_self_or_admin
on public.profiles for select
using (user_id = auth.uid() or public.is_admin());

create policy profiles_update_self
on public.profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy profiles_insert_own
on public.profiles for insert
with check (user_id = auth.uid());

create policy profiles_admin_all
on public.profiles for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- editions
-- ---------------------------------------------------------------------------

create policy editions_select_admin
on public.editions for select
using (public.is_admin());

create policy editions_select_evaluator
on public.editions for select
using (public.is_evaluator_of_edition(id));

create policy editions_select_viewer
on public.editions for select
using (public.is_public_viewer_of_edition(id));

create policy editions_select_public_open
on public.editions for select
using (public_results_visible = true);

create policy editions_write_admin
on public.editions for insert
with check (public.is_admin());

create policy editions_update_admin
on public.editions for update
using (public.is_admin())
with check (public.is_admin());

create policy editions_delete_admin
on public.editions for delete
using (public.is_admin());

-- ---------------------------------------------------------------------------
-- viewer_editions
-- ---------------------------------------------------------------------------

create policy viewer_editions_admin_all
on public.viewer_editions for all
using (public.is_admin())
with check (public.is_admin());

create policy viewer_editions_select_self
on public.viewer_editions for select
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create policy projects_select_admin
on public.projects for select
using (public.is_admin());

create policy projects_select_evaluator_assigned
on public.projects for select
using (
  public.is_evaluator_of_edition(edition_id)
  and exists (
    select 1 from public.evaluators e
    join public.project_evaluator_assignments pea on pea.evaluator_id = e.id
    where pea.project_id = projects.id and e.user_id = auth.uid()
  )
);

create policy projects_select_viewer
on public.projects for select
using (public.is_public_viewer_of_edition(edition_id));

create policy projects_select_public_open
on public.projects for select
using (
  exists (
    select 1 from public.editions ed
    where ed.id = projects.edition_id and ed.public_results_visible = true
  )
);

create policy projects_write_admin
on public.projects for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- teams / team_members
-- ---------------------------------------------------------------------------

create policy teams_select_privileged
on public.teams for select
using (
  public.is_admin()
  or public.is_public_viewer_of_edition(edition_id)
  or (
    public.is_evaluator_of_edition(edition_id)
    and exists (
      select 1 from public.project_evaluator_assignments pea
      join public.evaluators e on e.id = pea.evaluator_id
      where pea.project_id = teams.project_id and e.user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.editions ed
    where ed.id = teams.edition_id and ed.public_results_visible = true
  )
);

create policy teams_write_admin
on public.teams for all
using (public.is_admin())
with check (public.is_admin());

create policy team_members_select_privileged
on public.team_members for select
using (
  exists (
    select 1 from public.teams t
    where t.id = team_members.team_id
      and (
        public.is_admin()
        or public.is_public_viewer_of_edition(t.edition_id)
        or (
          public.is_evaluator_of_edition(t.edition_id)
          and exists (
            select 1 from public.project_evaluator_assignments pea
            join public.evaluators e on e.id = pea.evaluator_id
            where pea.project_id = t.project_id and e.user_id = auth.uid()
          )
        )
        or exists (
          select 1 from public.editions ed
          where ed.id = t.edition_id and ed.public_results_visible = true
        )
      )
  )
);

create policy team_members_write_admin
on public.team_members for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- evaluators
-- ---------------------------------------------------------------------------

create policy evaluators_select_admin
on public.evaluators for select
using (public.is_admin());

create policy evaluators_select_self
on public.evaluators for select
using (user_id = auth.uid());

create policy evaluators_write_admin
on public.evaluators for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- project_evaluator_assignments
-- ---------------------------------------------------------------------------

create policy pea_select_admin
on public.project_evaluator_assignments for select
using (public.is_admin());

create policy pea_select_evaluator_self
on public.project_evaluator_assignments for select
using (
  exists (
    select 1 from public.evaluators e
    where e.id = project_evaluator_assignments.evaluator_id
      and e.user_id = auth.uid()
  )
);

create policy pea_write_admin
on public.project_evaluator_assignments for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- project_documents / project_photos
-- ---------------------------------------------------------------------------

create policy project_documents_select_privileged
on public.project_documents for select
using (
  public.is_admin()
  or public.is_public_viewer_of_edition((select edition_id from public.projects p where p.id = project_id))
  or public.is_assigned_evaluator(project_id)
  or exists (
    select 1 from public.projects p
    join public.editions ed on ed.id = p.edition_id
    where p.id = project_id and ed.public_results_visible = true
  )
);

create policy project_documents_write_admin
on public.project_documents for insert
with check (public.is_admin());

create policy project_documents_update_admin
on public.project_documents for update
using (public.is_admin());

create policy project_documents_delete_admin
on public.project_documents for delete
using (public.is_admin());

create policy project_documents_write_evaluator
on public.project_documents for insert
with check (
  public.is_assigned_evaluator(project_id)
);

create policy project_documents_mutate_evaluator
on public.project_documents for update
using (public.is_assigned_evaluator(project_id));

create policy project_documents_delete_evaluator
on public.project_documents for delete
using (public.is_assigned_evaluator(project_id));

create policy project_photos_select_privileged
on public.project_photos for select
using (
  public.is_admin()
  or public.is_public_viewer_of_edition((select edition_id from public.projects p where p.id = project_id))
  or public.is_assigned_evaluator(project_id)
  or exists (
    select 1 from public.projects p
    join public.editions ed on ed.id = p.edition_id
    where p.id = project_id and ed.public_results_visible = true
  )
);

create policy project_photos_write_admin
on public.project_photos for all
using (public.is_admin())
with check (public.is_admin());

create policy project_photos_insert_evaluator
on public.project_photos for insert
with check (
  public.is_assigned_evaluator(project_id)
  and (uploaded_by is null or uploaded_by = auth.uid())
);

create policy project_photos_update_evaluator
on public.project_photos for update
using (
  public.is_assigned_evaluator(project_id)
  and (uploaded_by is null or uploaded_by = auth.uid())
);

create policy project_photos_delete_evaluator
on public.project_photos for delete
using (
  public.is_assigned_evaluator(project_id)
);

-- ---------------------------------------------------------------------------
-- evaluation_configs
-- ---------------------------------------------------------------------------

create policy evaluation_configs_select_privileged
on public.evaluation_configs for select
using (
  public.is_admin()
  or public.is_assigned_evaluator(project_id)
  or public.is_public_viewer_of_edition((select edition_id from public.projects p where p.id = project_id))
  or exists (
    select 1 from public.projects p
    join public.editions ed on ed.id = p.edition_id
    where p.id = project_id and ed.public_results_visible = true
  )
);

create policy evaluation_configs_write_admin
on public.evaluation_configs for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------

create policy evaluations_select_admin
on public.evaluations for select
using (public.is_admin());

create policy evaluations_select_evaluator_own
on public.evaluations for select
using (
  exists (
    select 1 from public.evaluators e
    where e.id = evaluations.evaluator_id and e.user_id = auth.uid()
  )
);

create policy evaluations_select_viewer
on public.evaluations for select
using (
  public.is_public_viewer_of_edition((select edition_id from public.projects p where p.id = project_id))
);

create policy evaluations_insert_evaluator
on public.evaluations for insert
with check (
  public.is_assigned_evaluator(project_id)
  and exists (
    select 1 from public.evaluators e
    where e.id = evaluator_id and e.user_id = auth.uid()
  )
);

create policy evaluations_update_evaluator_own
on public.evaluations for update
using (
  exists (
    select 1 from public.evaluators e
    where e.id = evaluations.evaluator_id and e.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.evaluators e
    where e.id = evaluator_id and e.user_id = auth.uid()
  )
);

create policy evaluations_delete_admin
on public.evaluations for delete
using (public.is_admin());

create policy evaluations_mutate_admin
on public.evaluations for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- evaluation_answers
-- ---------------------------------------------------------------------------

create policy evaluation_answers_select_admin
on public.evaluation_answers for select
using (
  public.is_admin()
  or exists (
    select 1 from public.evaluations ev
    join public.evaluators e on e.id = ev.evaluator_id
    where ev.id = evaluation_answers.evaluation_id and e.user_id = auth.uid()
  )
  or exists (
    select 1 from public.evaluations ev
    join public.projects p on p.id = ev.project_id
    where ev.id = evaluation_answers.evaluation_id
      and public.is_public_viewer_of_edition(p.edition_id)
  )
);

create policy evaluation_answers_write_evaluator
on public.evaluation_answers for insert
with check (
  exists (
    select 1 from public.evaluations ev
    join public.evaluators e on e.id = ev.evaluator_id
    where ev.id = evaluation_answers.evaluation_id
      and e.user_id = auth.uid()
      and public.is_assigned_evaluator(ev.project_id)
  )
);

create policy evaluation_answers_update_evaluator
on public.evaluation_answers for update
using (
  exists (
    select 1 from public.evaluations ev
    join public.evaluators e on e.id = ev.evaluator_id
    where ev.id = evaluation_answers.evaluation_id
      and e.user_id = auth.uid()
  )
);

create policy evaluation_answers_delete_evaluator
on public.evaluation_answers for delete
using (
  exists (
    select 1 from public.evaluations ev
    join public.evaluators e on e.id = ev.evaluator_id
    where ev.id = evaluation_answers.evaluation_id
      and e.user_id = auth.uid()
  )
);

create policy evaluation_answers_write_admin
on public.evaluation_answers for all
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- project_score_cache (ranking agregado; seguro para público anónimo)
-- ---------------------------------------------------------------------------

create policy score_cache_select_admin
on public.project_score_cache for select
using (public.is_admin());

create policy score_cache_select_evaluator_assigned
on public.project_score_cache for select
using (
  public.is_assigned_evaluator(project_id)
);

create policy score_cache_select_viewer
on public.project_score_cache for select
using (public.is_public_viewer_of_edition(edition_id));

create policy score_cache_select_public_open
on public.project_score_cache for select
using (
  exists (
    select 1 from public.editions ed
    where ed.id = project_score_cache.edition_id
      and ed.public_results_visible = true
  )
);

create policy score_cache_write_admin
on public.project_score_cache for all
using (public.is_admin())
with check (public.is_admin());

-- Escritura desde triggers de agregación (refresh/seed) cuando RLS está activo
create policy score_cache_trigger_insert
on public.project_score_cache for insert
with check (pg_trigger_depth() > 0);

create policy score_cache_trigger_update
on public.project_score_cache for update
using (pg_trigger_depth() > 0)
with check (pg_trigger_depth() > 0);

create policy score_cache_trigger_delete
on public.project_score_cache for delete
using (pg_trigger_depth() > 0);

-- ---------------------------------------------------------------------------
-- Grants lectura ranking (RLS aplica)
-- ---------------------------------------------------------------------------

grant select on public.project_score_cache to anon, authenticated;
grant select on public.public_project_rankings to anon, authenticated;
grant select on public.project_score_summary to anon, authenticated;
