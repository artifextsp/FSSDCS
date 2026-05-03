# Modelo de datos (Supabase)

## Principios

- **Edición (`editions`)** como raíz temporal: todo el contenido de una feria cuelga de una edición para reutilizar el sistema año a año.
- **Híbrido**: tablas normalizadas para entidades y relaciones; **`evaluation_configs.config` (jsonb)** para la variabilidad metodológica sin migraciones por cada cambio.
- **Puntaje**: promedio de jurados por fase (`evaluations` en estado `submitted`); **total** = sustentación + concurso (suma directa). Desempate alfabético por nombre de proyecto (en vista de ranking).
- **Cache (`project_score_cache`)**: agregados por proyecto para lectura pública con RLS y **Realtime** sin exponer respuestas item a item.

## Tablas principales

| Tabla | Rol |
|--------|-----|
| `editions` | Año/slug/estado; `public_results_visible` controla lectura pública anónima. |
| `profiles` | Perfil ligado a `auth.users`; `role`: `admin`, `evaluator`, `public_viewer`. |
| `viewer_editions` | Usuario autenticado “público” vinculado a ediciones que puede ver. |
| `projects` | Proyecto dentro de una edición; `name_normalized` único por edición. |
| `teams` | Equipo 1:1 con proyecto en MVP (`unique(project_id)`); nombre único por edición. |
| `team_members` | Integrantes listados (no hay cuentas por estudiante). |
| `evaluators` | Jurado (`user_id`) inscrito en una edición. |
| `project_evaluator_assignments` | Qué proyectos evalúa cada jurado. |
| `evaluation_configs` | Configuración activa por `phase` (`sustentation` \| `field_contest`) y `method_type`. |
| `evaluations` | Evaluación de un jurado para un proyecto con una config concreta. |
| `evaluation_answers` | Ítems calificados (`item_key`, `score`, `observation`, `meta`). |
| `project_documents` / `project_photos` | Metadatos; archivos en Storage (`storage_path`). |
| `project_score_cache` | `sustentation_avg`, `field_contest_avg`, `total_score` actualizados por triggers. |

## Vistas

- `public_project_rankings`: ranking por edición con `rank` (ventana SQL).
- `project_score_summary`: alias legible sobre el cache.

## RPC

- `team_portal_lookup(edition_slug, team_name)`: respuesta JSON para portal de equipos **sin autenticación**, sin filtrar tablas completas; incluye `scores` y `rank`.

## Storage

- Buckets: `project-documents`, `project-photos` (privados).
- Convención recomendada para fotos subidas desde jurado: `{project_id}/{nombreArchivo}`.

## Migraciones

Ver `supabase/migrations/` en orden cronológico.
