# Autenticación y RLS

## Roles de aplicación (`profiles.role`)

| Rol | Uso |
|-----|-----|
| `admin` | Configura edición, proyectos, equipos, configs, jurados, documentos y fotos. |
| `evaluator` | Jurado: solo proyectos asignados; crea/actualiza sus `evaluations` y `evaluation_answers`; sube fotos. |
| `public_viewer` | Cuenta compartida o invitada para comunidad: lectura ampliada según `viewer_editions`. |

> El “espectador anónimo” del MVP se modela con `editions.public_results_visible = true` y lectura controlada de tablas/vistas públicas (sin exponer evaluaciones detalladas de jurados).

## Equipos sin contraseña

- No hay `auth` para estudiantes.
- El acceso es vía **`team_portal_lookup(edition_slug, team_name)`** (función `SECURITY DEFINER`) que devuelve solo el proyecto vinculado al equipo cuyo nombre coincide (normalizado), más agregados de puntaje.
- **Riesgo**: nombres duplicados o fáciles de adivinar. El esquema fuerza **nombre de equipo único por edición** (`teams (edition_id, name_normalized)`).

## Jurados

- Cuenta Supabase Auth normal.
- Fila en `evaluators` por edición y filas en `project_evaluator_assignments`.

## Público autenticado (opción “credencial compartida”)

1. Crear usuario (por ejemplo `feria.publico@dominio.edu`).
2. `profiles.role = 'public_viewer'`.
3. Insertar filas en `viewer_editions` para las ediciones visibles.
4. Compartir usuario/contraseña con la comunidad (rotación manual de password).

## Público anónimo

- Si `public_results_visible` es `true`, las políticas permiten `SELECT` acotado en proyectos, equipos, integrantes, documentos, fotos, configs y **cache/vistas de ranking**.
- **No** se expone `evaluations` / `evaluation_answers` a anónimos (solo agregados en `project_score_cache` / vistas).

## Storage

- Políticas en `storage.objects` alineadas con asignación de jurado y modo público.
- Fotos: convención de ruta `{project_id}/...` para permitir subida **antes** de registrar la fila en `project_photos`.

## Funciones internas

- `refresh_project_score_cache` y triggers asociados tienen `EXECUTE` revocado al rol `public` para reducir superficie.
