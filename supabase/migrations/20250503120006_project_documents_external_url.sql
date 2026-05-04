-- Permite que un "documento" de proyecto sea un archivo subido (storage_path)
-- o un enlace externo (external_url), pero no ambos a la vez ni ninguno.

alter table public.project_documents
  add column if not exists external_url text;

alter table public.project_documents
  alter column storage_path drop not null;

alter table public.project_documents
  drop constraint if exists project_documents_source_check;

alter table public.project_documents
  add constraint project_documents_source_check
  check (
    (storage_path is not null and external_url is null)
    or (storage_path is null and external_url is not null)
  );
