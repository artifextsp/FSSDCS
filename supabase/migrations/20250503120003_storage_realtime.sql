-- Feria STEAM - Storage buckets y Realtime

-- ---------------------------------------------------------------------------
-- Buckets (privados; acceso vía RLS de storage.objects)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'project-documents',
    'project-documents',
    false,
    52428800,
    array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']::text[]
  ),
  (
    'project-photos',
    'project-photos',
    false,
    15728640,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Políticas Storage: documentos
-- ---------------------------------------------------------------------------

create policy project_documents_objects_select
on storage.objects for select
to authenticated, anon
using (
  bucket_id = 'project-documents'
  and exists (
    select 1
    from public.project_documents d
    where d.storage_path = storage.objects.name
      and (
        public.is_admin()
        or public.is_assigned_evaluator(d.project_id)
        or public.is_public_viewer_of_edition(
          (select edition_id from public.projects p where p.id = d.project_id)
        )
        or exists (
          select 1
          from public.projects p
          join public.editions e on e.id = p.edition_id
          where p.id = d.project_id and e.public_results_visible = true
        )
      )
  )
);

create policy project_documents_objects_insert_admin
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-documents'
  and public.is_admin()
);

create policy project_documents_objects_mutate_admin
on storage.objects for update
to authenticated
using (bucket_id = 'project-documents' and public.is_admin());

create policy project_documents_objects_delete_admin
on storage.objects for delete
to authenticated
using (bucket_id = 'project-documents' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Políticas Storage: fotos (jurado asignado puede subir)
-- ---------------------------------------------------------------------------

create policy project_photos_objects_select
on storage.objects for select
to authenticated, anon
using (
  bucket_id = 'project-photos'
  and exists (
    select 1
    from public.project_photos ph
    where ph.storage_path = storage.objects.name
      and (
        public.is_admin()
        or public.is_assigned_evaluator(ph.project_id)
        or public.is_public_viewer_of_edition(
          (select edition_id from public.projects p where p.id = ph.project_id)
        )
        or exists (
          select 1
          from public.projects p
          join public.editions e on e.id = p.edition_id
          where p.id = ph.project_id and e.public_results_visible = true
        )
      )
  )
);

-- Convención de ruta: {project_id}/{filename} (UUID de proyecto en primer segmento)
create policy project_photos_objects_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_assigned_evaluator((split_part(name, '/', 1))::uuid)
    )
  )
);

create policy project_photos_objects_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'project-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_assigned_evaluator((split_part(name, '/', 1))::uuid)
    )
  )
);

create policy project_photos_objects_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_assigned_evaluator((split_part(name, '/', 1))::uuid)
    )
  )
);

-- ---------------------------------------------------------------------------
-- Realtime: tablas útiles para UI en vivo
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.project_score_cache';
  exception
    when duplicate_object then null;
  end;

  begin
    execute 'alter publication supabase_realtime add table public.evaluations';
  exception
    when duplicate_object then null;
  end;

  begin
    execute 'alter publication supabase_realtime add table public.project_photos';
  exception
    when duplicate_object then null;
  end;

  begin
    execute 'alter publication supabase_realtime add table public.projects';
  exception
    when duplicate_object then null;
  end;
end;
$$;
