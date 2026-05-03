-- Feria STEAM - Schema inicial (MVP)
-- Requiere: pgcrypto (para hashing opcional de acceso público)

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.edition_status as enum ('draft', 'active', 'archived');

create type public.evaluation_phase as enum ('sustentation', 'field_contest');

create type public.evaluation_method_type as enum (
  'questionnaire',
  'interview',
  'questionnaire_interview',
  'process_phases',
  'process_phases_interview',
  'field_rounds'
);

create type public.evaluation_record_status as enum ('draft', 'submitted');

create type public.app_role as enum ('admin', 'evaluator', 'public_viewer');

-- ---------------------------------------------------------------------------
-- Utilidad: updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ediciones
-- ---------------------------------------------------------------------------

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  name text not null,
  slug text not null unique,
  status public.edition_status not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  public_results_visible boolean not null default false,
  public_gate_enabled boolean not null default false,
  public_gate_secret_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger editions_set_updated_at
before update on public.editions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role public.app_role not null default 'evaluator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-crear perfil al registrarse (rol por defecto evaluator; admin se ajusta manualmente o vía seed)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'evaluator'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Acceso público: usuarios compartidos vinculados a edición(es)
-- ---------------------------------------------------------------------------

create table public.viewer_editions (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  edition_id uuid not null references public.editions (id) on delete cascade,
  primary key (user_id, edition_id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Proyectos y equipos
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,
  name text not null,
  name_normalized text generated always as (lower(trim(name))) stored,
  description text,
  grade_label text,
  presentation_order int,
  room text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, name_normalized)
);

create index projects_edition_idx on public.projects (edition_id);

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  name_normalized text generated always as (lower(trim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  unique (edition_id, name_normalized)
);

create or replace function public.teams_sync_edition_from_project()
returns trigger
language plpgsql
as $$
begin
  select edition_id into strict new.edition_id
  from public.projects where id = new.project_id;
  return new;
end;
$$;

create trigger teams_sync_edition_before_insert
before insert on public.teams
for each row execute function public.teams_sync_edition_from_project();

create trigger teams_sync_edition_before_update
before update of project_id on public.teams
for each row execute function public.teams_sync_edition_from_project();

create trigger teams_set_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  full_name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index team_members_team_idx on public.team_members (team_id);

-- ---------------------------------------------------------------------------
-- Jurados
-- ---------------------------------------------------------------------------

create table public.evaluators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  edition_id uuid not null references public.editions (id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, edition_id)
);

create index evaluators_edition_idx on public.evaluators (edition_id);

create table public.project_evaluator_assignments (
  project_id uuid not null references public.projects (id) on delete cascade,
  evaluator_id uuid not null references public.evaluators (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, evaluator_id)
);

-- ---------------------------------------------------------------------------
-- Documentos y fotos (rutas en Storage)
-- ---------------------------------------------------------------------------

create table public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index project_documents_project_idx on public.project_documents (project_id);

create table public.project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index project_photos_project_idx on public.project_photos (project_id);

-- ---------------------------------------------------------------------------
-- Configuración de evaluación por proyecto
-- ---------------------------------------------------------------------------

create table public.evaluation_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  phase public.evaluation_phase not null,
  method_type public.evaluation_method_type not null,
  scale_min int not null default 0,
  scale_max int not null default 5,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create index evaluation_configs_project_phase_idx
  on public.evaluation_configs (project_id, phase)
  where is_active = true;

-- Solo una configuración activa por proyecto y fase
create unique index evaluation_configs_one_active_per_phase
  on public.evaluation_configs (project_id, phase)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- Evaluaciones y respuestas
-- ---------------------------------------------------------------------------

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  evaluator_id uuid not null references public.evaluators (id) on delete cascade,
  evaluation_config_id uuid not null references public.evaluation_configs (id) on delete restrict,
  phase public.evaluation_phase not null,
  status public.evaluation_record_status not null default 'draft',
  total_score numeric(12,4),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, evaluator_id, evaluation_config_id)
);

create index evaluations_project_phase_idx on public.evaluations (project_id, phase);
create index evaluations_evaluator_idx on public.evaluations (evaluator_id);

create trigger evaluations_set_updated_at
before update on public.evaluations
for each row execute function public.set_updated_at();

create table public.evaluation_answers (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations (id) on delete cascade,
  item_key text not null,
  score numeric(12,4),
  observation text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, item_key)
);

create index evaluation_answers_evaluation_idx on public.evaluation_answers (evaluation_id);

create trigger evaluation_answers_set_updated_at
before update on public.evaluation_answers
for each row execute function public.set_updated_at();

-- Recalcular total_score de la evaluación como suma de scores
create or replace function public.recalc_evaluation_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eid uuid;
  s numeric(12,4);
begin
  eid := coalesce(new.evaluation_id, old.evaluation_id);
  select coalesce(sum(score), 0) into s from public.evaluation_answers where evaluation_id = eid;
  update public.evaluations set total_score = s where id = eid;
  return coalesce(new, old);
end;
$$;

create trigger evaluation_answers_recalc_insert
after insert on public.evaluation_answers
for each row execute function public.recalc_evaluation_total();

create trigger evaluation_answers_recalc_update
after update on public.evaluation_answers
for each row execute function public.recalc_evaluation_total();

create trigger evaluation_answers_recalc_delete
after delete on public.evaluation_answers
for each row execute function public.recalc_evaluation_total();

-- ---------------------------------------------------------------------------
-- Comentarios en tablas (documentación en BD)
-- ---------------------------------------------------------------------------

comment on table public.editions is 'Edición anual reutilizable de la feria.';
comment on table public.evaluation_configs is 'Configuración flexible por proyecto; detalle en config (jsonb).';
comment on column public.evaluation_answers.item_key is 'Identificador estable: p.ej. q:uuid, phase:analysis, round:r1.';
comment on table public.evaluations is 'Una fila por jurado y configuración de evaluación (incluye fase).';
