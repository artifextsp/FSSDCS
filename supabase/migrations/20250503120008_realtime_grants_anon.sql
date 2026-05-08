-- Habilitar Realtime para team_score_cache (reemplaza project_score_cache que ya no existe)
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.team_score_cache';
  exception
    when duplicate_object then null;
  end;
end;
$$;

-- Dar SELECT a anon sobre las tablas que el frontend usa sin autenticacion.
-- Las políticas RLS filtran las filas (solo visible cuando public_results_visible=true).
grant select on public.team_score_cache to anon;
grant select on public.editions to anon;
grant select on public.projects to anon;
grant select on public.teams to anon;
grant select on public.team_members to anon;
grant select on public.project_documents to anon;
grant select on public.team_photos to anon;
grant select on public.evaluation_configs to anon;
grant select on public.public_team_rankings to anon;
