-- Bug en las policies de storage del bucket project-photos: dentro del
-- EXISTS la expresion comparaba `t.id = (split_part(t.name, '/', 1))::uuid`,
-- usando `t.name` (el NOMBRE DEL EQUIPO, e.g. "AMERICANITOS") en vez de
-- `objects.name` (el path del archivo, "<uuid>/<filename>"). Por eso al
-- intentar subir, Postgres trataba de castear el nombre del equipo a uuid
-- y reventaba con `invalid input syntax for type uuid: "AMERICANITOS"`.
-- Para admins funcionaba porque `is_admin()` corta el OR antes del EXISTS.
-- Solucion: comparar `t.id` contra `(split_part(objects.name, '/', 1))::uuid`.

drop policy if exists team_photos_objects_insert on storage.objects;
create policy team_photos_objects_insert on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-photos'::text
  and (
    public.is_admin()
    or (
      split_part(objects.name, '/'::text, 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
          from public.teams t
         where t.id = (split_part(objects.name, '/'::text, 1))::uuid
           and public.is_assigned_evaluator(t.project_id)
      )
    )
  )
);

drop policy if exists team_photos_objects_update on storage.objects;
create policy team_photos_objects_update on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-photos'::text
  and (
    public.is_admin()
    or (
      split_part(objects.name, '/'::text, 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
          from public.teams t
         where t.id = (split_part(objects.name, '/'::text, 1))::uuid
           and public.is_assigned_evaluator(t.project_id)
      )
    )
  )
);

drop policy if exists team_photos_objects_delete on storage.objects;
create policy team_photos_objects_delete on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-photos'::text
  and (
    public.is_admin()
    or (
      split_part(objects.name, '/'::text, 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
          from public.teams t
         where t.id = (split_part(objects.name, '/'::text, 1))::uuid
           and public.is_assigned_evaluator(t.project_id)
      )
    )
  )
);
