# Feria STEAM — Seminario Diocesano Cristo Sacerdote

Plataforma oficial de gestión de la Feria STEAM. Frontend HTML + CSS + JS vanilla puro y backend Supabase (Postgres + Auth + Storage + Realtime).

Repositorio: [artifextsp/FSSDCS](https://github.com/artifextsp/FSSDCS)

## Vista general

- Página de inicio moderna y mobile-first.
- Catálogo público de proyectos con buscador.
- Detalle de proyecto con carrusel de fotos en vivo, documentos, integrantes, configuración y puntajes.
- Ranking en tiempo real (Supabase Realtime).
- Portal de equipos accesible **solo con el nombre del equipo** (sin contraseña), con seguridad vía RPC.
- App de jurado mobile-first: proyectos asignados, formulario dinámico que se adapta a la metodología configurada, captura de fotos desde la cámara, guardado por ítem.
- Panel administrador completo: ediciones, proyectos, equipos (con importación CSV/XLSX/PDF), jurados, configuración de evaluación por proyecto y fase, documentos, fotos, asignación de jurados y ranking.

## Estructura del repositorio

```
.
├── index.html
├── 404.html
├── .nojekyll
├── .github/workflows/pages.yml      # CI: Deploy a GitHub Pages
├── assets/
│   ├── css/                         # tokens, base, componentes
│   └── js/
│       ├── app.js                   # bootstrap
│       ├── config.js                # URL/Anon key
│       ├── supabase.js              # cliente Supabase
│       ├── auth.js                  # estado de auth
│       ├── data.js                  # consultas y mutaciones
│       ├── parsers.js               # CSV / XLSX / PDF
│       ├── realtime.js              # canales realtime
│       ├── router.js                # router por hash
│       ├── state.js                 # edición seleccionada
│       ├── utils.js                 # DOM, toasts, modales
│       └── views/                   # vistas por ruta
├── docs/                            # documentos de arquitectura
└── supabase/
    └── migrations/                  # esquema, RLS, RPC, storage
```

## Configuración rápida

### 1. Aplicar migraciones a Supabase

Requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase link --project-ref zouqozwpoyxhhhfhpymc
supabase db push
```

Las migraciones crean:
- Esquema completo (entidades, configs, evaluaciones, cache de puntajes).
- RLS estricta para anon, equipos, jurado y admin.
- RPC `team_portal_lookup` para portal de equipos sin contraseña.
- RPC `admin_add_evaluator_by_email` para gestionar jurados desde el panel.
- Buckets `project-documents` y `project-photos` con políticas.
- Vistas `public_project_rankings` y `project_score_summary`.
- Realtime habilitado en tablas clave.

### 2. Crear primer administrador

1. Inicia la app y ve a `#/admin`. Usa "Crear cuenta nueva" con tu correo y contraseña (es la misma cuenta de Supabase Auth).
2. En el SQL Editor de Supabase corre:

```sql
update public.profiles set role = 'admin'
where user_id = (select id from auth.users where email = 'TU_CORREO');
```

3. Refresca la app: ahora verás el panel de administrador.

### 3. Variables

Las claves públicas de Supabase ya están preconfiguradas en `assets/js/config.js`:

```js
SUPABASE_URL = "https://zouqozwpoyxhhhfhpymc.supabase.co";
SUPABASE_KEY = "<publishable/anon key>";
```

> **Nunca** guardes la `service_role` aquí ni en el repo. Esta plataforma solo usa la clave publicable y delega toda la seguridad en RLS.

## Roles

- **Anónimo (espectador)**: lectura pública (proyectos, ranking, fotos, documentos) cuando el admin marca la edición como `public_results_visible`.
- **Equipo**: portal sin contraseña vía nombre de equipo (único por edición).
- **Jurado** (`evaluator`): cuenta Supabase Auth normal. Solo ve y evalúa los proyectos a los que el admin lo asigna; puede tomar fotos desde su celular.
- **Administrador** (`admin`): control total.

## Flujo recomendado para usar la plataforma en una feria

1. **Admin** crea una edición (`#/admin/ediciones`) y la activa.
2. Crea proyectos (`#/admin/proyectos`) con datos básicos (grado, aula, orden).
3. En cada proyecto:
   - Define el equipo y los integrantes (puede pegar lista o subir Excel/CSV/PDF).
   - Sube documentos de referencia (rúbricas, cuestionarios).
   - Configura la metodología de **sustentación** y/o **concurso de campo** desde la pestaña "Evaluación" (con plantillas precargadas; editas la lista de preguntas, fases o rondas en JSON).
4. Registra a los jurados (`#/admin/jurados`) por correo, después de que cada uno se haya creado cuenta en `#/jurado`.
5. Asigna jurados a cada proyecto (pestaña "Jurados" dentro del proyecto).
6. Cuando comience la jornada, los jurados acceden a `#/jurado`, eligen el proyecto y evalúan.
7. El ranking se actualiza en vivo en `#/ranking` y en la cabecera de cada proyecto.
8. Cuando todo esté listo, en "Resumen" del admin marca **Publicar resultados** para abrirlos a la comunidad.

## Despliegue (GitHub Pages)

El workflow `.github/workflows/pages.yml` despliega automáticamente al hacer push a `main`. Solo necesitas activar GitHub Pages en *Settings → Pages → Build from a GitHub Actions workflow*.

URL final: `https://artifextsp.github.io/FSSDCS/`.

## Notas de diseño

- Hash routing (`#/...`): permite hospedar como sitio estático sin reconfiguración del servidor.
- Sin frameworks: solo módulos ES nativos del navegador.
- Cliente Supabase cargado por ESM CDN.
- XLSX y PDF.js se cargan bajo demanda solo cuando el admin importa una lista.
- Sistema de diseño con tokens CSS, totalmente responsive.

## Documentación adicional

- [Modelo de datos](docs/DATA_MODEL.md)
- [Autenticación y RLS](docs/AUTH_RLS.md)
- [Motor de configuración JSON](docs/CONFIG_ENGINE.md)
