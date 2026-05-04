import { clear, el, toast, confirmDialog, slugify, fmtScore, openModal } from "../utils.js?v=13";
import { getAuthSnapshot, signInWithPassword, signOut } from "../auth.js?v=13";
import { getCurrentEdition, setCurrentEdition } from "../state.js?v=13";
import {
  listEditionsAccessible, createEdition, updateEdition,
  listProjects, getProjectFull, createProject, updateProject, deleteProject,
  listTeamsByProject, getTeamFull, createTeam, updateTeam, deleteTeam,
  replaceTeamMembers, listTeamMembers,
  listEvaluators, setAssignment, listAssignmentsForEdition,
  listConfigs, upsertActiveConfig,
  uploadProjectDocument, addProjectLink, deleteProjectDocument, resolveDocUrl,
  uploadTeamPhoto, deleteTeamPhoto, signedPhotoUrl, listTeamPhotos,
  listRanking,
} from "../data.js?v=13";
import { supabase } from "../supabase.js?v=13";
import { parseFile } from "../parsers.js?v=13";
import { navigate } from "../router.js?v=13";

export async function renderAdmin({ section = "dashboard", projectId = null, teamId = null } = {}) {
  console.log("[admin] renderAdmin start", { section, projectId, teamId });
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const auth = getAuthSnapshot();
  console.log("[admin] auth snapshot", { ready: auth.ready, hasSession: !!auth.session, role: auth.profile?.role });
  if (!auth.ready) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Verificando sesión…" }),
    ]));
    return;
  }
  if (!auth.session) return paintLogin(wrap);
  // Sesión cacheada pero perfil aún cargando: esperamos un instante a que
  // llegue para no mostrar el banner de "no eres admin" injustamente.
  if (!auth.profile) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Cargando perfil…" }),
    ]));
    return;
  }
  if (auth.profile.role !== "admin") {
    wrap.append(el("div", { class: "error-banner" }, [
      "Tu cuenta no tiene rol de administrador. ",
      el("br"),
      "Pídele al admin principal que actualice tu perfil. ",
      el("code", { text: `select id from auth.users where email='${auth.session.user.email}'` }),
    ]));
    return;
  }

  console.log("[admin] fetching editions…");
  const editions = await listEditionsAccessible().catch((e) => {
    console.error("[admin] listEditionsAccessible failed", e);
    return [];
  });
  console.log("[admin] editions:", editions.length);
  if (!getCurrentEdition() && editions.length) setCurrentEdition(editions[0]);

  const header = el("div", { class: "section-head" });
  wrap.append(header);

  const editionSelect = el("select", { class: "select", style: { maxWidth: "320px" }, onchange: () => {
    const ed = editions.find((e) => e.id === editionSelect.value);
    if (ed) setCurrentEdition(ed);
    navigate("/admin/" + (section === "team" ? "proyectos" : section));
  }});
  if (!editions.length) editionSelect.append(el("option", { value: "", text: "Sin ediciones" }));
  else editions.forEach((e) =>
    editionSelect.append(el("option", { value: e.id, text: `${e.year} · ${e.name}${e.status === "active" ? " · activa" : ""}` }))
  );
  if (getCurrentEdition()) editionSelect.value = getCurrentEdition().id;

  header.append(el("div", {}, [
    el("h1", { text: "Panel de administración" }),
    el("p", { class: "text-muted", text: "Configura ediciones, proyectos, equipos, jurados y resultados." }),
  ]));
  header.append(el("div", { class: "flex gap-2 items-center", style: { flexWrap: "wrap" } }, [
    editionSelect,
    el("button", { class: "btn btn--ghost btn--sm", text: "Salir", onclick: async () => { await signOut(); renderAdmin({ section }); } }),
  ]));

  const tabs = el("div", { class: "tabs" });
  [["dashboard", "Resumen"], ["ediciones", "Ediciones"], ["proyectos", "Proyectos"], ["jurados", "Jurados"], ["ranking", "Ranking"]]
    .forEach(([k, l]) => tabs.append(el("a", { class: `tabs__btn ${section === k ? "is-active" : ""}`, href: `#/admin/${k}`, text: l })));
  wrap.append(tabs);

  const body = el("div");
  wrap.append(body);

  if (section === "dashboard") return renderDashboard(body);
  if (section === "ediciones") return renderEditions(body, editions);
  if (section === "proyectos") return renderProjectsAdmin(body);
  if (section === "jurados") return renderEvaluatorsAdmin(body);
  if (section === "ranking") return renderRankingAdmin(body);
  if (section === "proyecto") return renderProjectAdmin(body, projectId);
  if (section === "team") return renderTeamAdmin(body, teamId);
  body.append(el("div", { class: "empty", text: "Sección no encontrada." }));
}

/* ---------------- Login ---------------- */
function paintLogin(root) {
  const emailEl = el("input", { class: "input", type: "email", required: true, autocomplete: "username", placeholder: "admin@correo.com" });
  const passEl = el("input", { class: "input", type: "password", required: true, autocomplete: "current-password", placeholder: "••••••••" });
  const errBox = el("div", { class: "field__error" });

  const form = el("form", { class: "card auth-shell", onsubmit: async (e) => {
    e.preventDefault(); errBox.textContent = "";
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { await signInWithPassword(emailEl.value.trim(), passEl.value); renderAdmin({ section: "dashboard" }); }
    catch (err) { errBox.textContent = err?.message || "No se pudo iniciar sesión"; }
    finally { if (btn) btn.disabled = false; }
  }}, [
    el("h1", { text: "Acceso administrador" }),
    el("p", { class: "text-muted mb-3", text: "Ingresa con tu cuenta de administrador. Si es la primera vez, regístrate aquí y luego un administrador existente debe actualizar tu rol en SQL." }),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Correo" }), emailEl]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Contraseña" }), passEl]),
    errBox,
    el("button", { class: "btn btn--primary btn--lg btn--block", type: "submit", text: "Entrar" }),
    el("div", { class: "divider" }),
    el("button", { class: "btn btn--ghost btn--block", type: "button", text: "Crear cuenta nueva", onclick: async () => {
      errBox.textContent = "";
      try {
        const { error } = await supabase.auth.signUp({ email: emailEl.value.trim(), password: passEl.value });
        if (error) throw error;
        toast("Cuenta creada. Si Supabase exige verificación, revisa tu correo.", "success");
      } catch (err) { errBox.textContent = err.message; }
    } }),
  ]);
  root.append(form);
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard(body) {
  const ed = getCurrentEdition();
  if (!ed) { body.append(el("div", { class: "empty", text: "Crea una edición para comenzar." })); return; }
  const [projects, ranking] = await Promise.all([
    listProjects(ed.id).catch(() => []),
    listRanking(ed.id).catch(() => []),
  ]);
  body.append(el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" } }, [
    metricCard("Edición", `${ed.year} · ${ed.name}`),
    metricCard("Proyectos", projects.length),
    metricCard("Equipos", ranking.length),
    metricCard("Top puntaje", ranking[0] ? fmtScore(ranking[0].total_score) : "—"),
  ]));

  body.append(el("div", { class: "card mt-5" }, [
    el("h3", { class: "card__title", text: "Estado de la edición" }),
    el("p", { class: "text-muted", text: `Estado: ${ed.status} · Resultados públicos: ${ed.public_results_visible ? "sí" : "no"}` }),
    el("div", { class: "btn-row mt-3" }, [
      ed.status !== "active" ? el("button", { class: "btn btn--primary", text: "Activar edición", onclick: async () => {
        try {
          const all = await listEditionsAccessible();
          for (const x of all) if (x.id !== ed.id && x.status === "active") await updateEdition(x.id, { status: "draft" });
          await updateEdition(ed.id, { status: "active" });
          toast("Edición activada", "success"); renderAdmin({ section: "dashboard" });
        } catch (e) { toast("Error: " + (e?.message || ""), "error"); }
      } }) : null,
      el("button", { class: "btn btn--ghost", text: ed.public_results_visible ? "Ocultar resultados" : "Publicar resultados", onclick: async () => {
        try { await updateEdition(ed.id, { public_results_visible: !ed.public_results_visible }); toast("Visibilidad actualizada", "success"); renderAdmin({ section: "dashboard" }); }
        catch (e) { toast("Error: " + (e?.message || ""), "error"); }
      } }),
    ]),
  ]));
}

function metricCard(label, value) {
  return el("div", { class: "card metric" }, [
    el("div", { class: "metric__label", text: label }),
    el("div", { class: "metric__value", text: String(value) }),
  ]);
}

/* ---------------- Ediciones ---------------- */
async function renderEditions(body, editions) {
  body.append(el("div", { class: "section-head" }, [
    el("h2", { text: "Ediciones" }),
    el("button", { class: "btn btn--primary", text: "Nueva edición", onclick: openCreate }),
  ]));
  const list = el("div", { class: "flex-col gap-3" });
  body.append(list);
  if (!editions.length) { list.append(el("div", { class: "empty", text: "Aún no has creado ninguna edición." })); return; }
  editions.forEach((ed) => list.append(editionRow(ed)));

  function editionRow(ed) {
    const yearEl = el("input", { class: "input", value: ed.year, type: "number" });
    const nameEl = el("input", { class: "input", value: ed.name });
    const slugEl = el("input", { class: "input", value: ed.slug });
    const statusEl = el("select", { class: "select" });
    ["draft", "active", "archived"].forEach((s) => statusEl.append(el("option", { value: s, text: s, selected: s === ed.status })));
    const visEl = el("input", { type: "checkbox", checked: !!ed.public_results_visible });
    return el("div", { class: "card" }, [
      el("div", { class: "field-row field-row--4" }, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Año" }), yearEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Nombre" }), nameEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Slug" }), slugEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Estado" }), statusEl]),
      ]),
      el("label", { class: "flex items-center gap-2 text-muted", style: { fontSize: "0.9rem" } }, [visEl, "Resultados visibles públicamente"]),
      el("div", { class: "btn-row mt-3" }, [
        el("button", { class: "btn btn--primary", text: "Guardar cambios", onclick: async () => {
          try {
            await updateEdition(ed.id, {
              year: Number(yearEl.value),
              name: nameEl.value.trim(),
              slug: slugEl.value.trim() || slugify(nameEl.value),
              status: statusEl.value,
              public_results_visible: visEl.checked,
            });
            toast("Edición actualizada", "success");
            renderAdmin({ section: "ediciones" });
          } catch (e) { toast("Error: " + (e?.message || ""), "error"); }
        }}),
      ]),
    ]);
  }

  async function openCreate() {
    const yearEl = el("input", { class: "input", type: "number", value: new Date().getFullYear() });
    const nameEl = el("input", { class: "input", placeholder: "Feria STEAM 2026" });
    const slugEl = el("input", { class: "input", placeholder: "feria-2026" });
    nameEl.addEventListener("input", () => { if (!slugEl.value) slugEl.placeholder = slugify(nameEl.value); });
    const r = await openModal({
      title: "Nueva edición",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Año" }), yearEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Nombre" }), nameEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Slug" }), slugEl]),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        { label: "Crear", variant: "primary", onClick: async () => {
          if (!nameEl.value.trim()) throw new Error("Nombre requerido");
          if (!yearEl.value) throw new Error("Año requerido");
          const ed = await createEdition({
            year: Number(yearEl.value),
            name: nameEl.value.trim(),
            slug: (slugEl.value || slugify(nameEl.value)).trim(),
            status: "draft",
          });
          setCurrentEdition(ed);
          return true;
        } },
      ],
    });
    if (r) renderAdmin({ section: "ediciones" });
  }
}

/* ---------------- Proyectos (lista) ---------------- */
async function renderProjectsAdmin(body) {
  const ed = getCurrentEdition();
  if (!ed) { body.append(el("div", { class: "empty", text: "Selecciona una edición." })); return; }
  body.append(el("div", { class: "section-head" }, [
    el("h2", { text: `Proyectos · ${ed.name}` }),
    el("button", { class: "btn btn--primary", text: "Nuevo proyecto", onclick: openCreate }),
  ]));
  const grid = el("div", { class: "grid grid--cards" });
  body.append(grid);

  let projects = [];
  try { projects = await listProjects(ed.id); }
  catch { grid.append(el("div", { class: "error-banner", text: "Error cargando proyectos." })); return; }
  if (!projects.length) { grid.append(el("div", { class: "empty", text: "Aún no hay proyectos. Crea el primero." })); return; }

  // contar equipos
  const teamCounts = {};
  await Promise.all(projects.map(async (p) => { teamCounts[p.id] = (await listTeamsByProject(p.id).catch(() => [])).length; }));

  projects.forEach((p) => grid.append(projectAdminCard(p)));

  function projectAdminCard(p) {
    return el("div", { class: "card" }, [
      el("div", { class: "card__title", text: p.name }),
      el("div", { class: "card__subtitle", text: [
        p.grade_label && `Grado ${p.grade_label}`,
        `${teamCounts[p.id] ?? 0} equipos`,
      ].filter(Boolean).join(" · ") }),
      p.description ? el("p", { class: "text-muted", text: p.description.slice(0, 120) + (p.description.length > 120 ? "…" : "") }) : null,
      el("div", { class: "btn-row mt-3" }, [
        el("a", { class: "btn btn--primary btn--sm", href: `#/admin/proyectos/${p.id}`, text: "Configurar →" }),
        el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
          const ok = await confirmDialog(`Se eliminará "${p.name}" y todos sus equipos, evaluaciones, fotos y documentos.`, { okLabel: "Eliminar", danger: true });
          if (!ok) return;
          try { await deleteProject(p.id); toast("Proyecto eliminado", "success"); renderAdmin({ section: "proyectos" }); }
          catch (e) { toast("Error: " + (e?.message || ""), "error"); }
        } }),
      ]),
    ]);
  }

  async function openCreate() {
    const nameEl = el("input", { class: "input", placeholder: "Nombre del proyecto (ej. TARARÁ)" });
    const gradeEl = el("input", { class: "input", placeholder: "Ej. 2°, 8°-11°" });
    const descEl = el("textarea", { class: "textarea", placeholder: "Descripción breve (opcional)" });
    const r = await openModal({
      title: "Nuevo proyecto",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Nombre" }), nameEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Grado / Grupo" }), gradeEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Descripción" }), descEl]),
        el("p", { class: "field__hint", text: "Después podrás agregar varios equipos al proyecto y configurar la metodología de evaluación." }),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        { label: "Crear", variant: "primary", onClick: async () => {
          if (!nameEl.value.trim()) throw new Error("El nombre es obligatorio");
          await createProject({
            edition_id: ed.id,
            name: nameEl.value.trim(),
            description: descEl.value.trim() || null,
            grade_label: gradeEl.value.trim() || null,
          });
          return true;
        } },
      ],
    });
    if (r) renderAdmin({ section: "proyectos" });
  }
}

/* ---------------- Proyecto · detalle ---------------- */
async function renderProjectAdmin(body, projectId) {
  if (!projectId) { body.append(el("div", { class: "empty", text: "Proyecto inválido." })); return; }
  body.append(el("a", { class: "btn btn--ghost btn--sm", href: "#/admin/proyectos", text: "← Volver a proyectos" }));

  let bundle;
  try { bundle = await getProjectFull(projectId); }
  catch (e) { body.append(el("div", { class: "error-banner", text: "Error cargando: " + (e?.message || "") })); return; }
  if (!bundle?.project) { body.append(el("div", { class: "empty", text: "Proyecto no encontrado." })); return; }
  const { project, teams, docs, configs, scores } = bundle;

  body.append(el("h2", { class: "mt-3", text: project.name }));
  body.append(el("p", { class: "text-muted", text: project.grade_label ? `Grado: ${project.grade_label}` : "" }));

  const subtabs = el("div", { class: "tabs" });
  ["detalles", "equipos", "evaluacion", "documentos", "jurados"].forEach((k) => {
    subtabs.append(el("button", { class: "tabs__btn", "data-key": k, text: ({
      detalles: "Detalles", equipos: "Equipos", evaluacion: "Evaluación", documentos: "Documentos", jurados: "Jurados",
    })[k], onclick: () => activate(k) }));
  });
  body.append(subtabs);
  const panel = el("div");
  body.append(panel);

  function activate(k) {
    Array.from(subtabs.children).forEach((b) => b.classList.toggle("is-active", b.dataset.key === k));
    clear(panel);
    if (k === "detalles") return mountDetails(panel, project);
    if (k === "equipos") return mountTeamsList(panel, project, teams, scores);
    if (k === "evaluacion") return mountConfigs(panel, project, configs);
    if (k === "documentos") return mountDocs(panel, project, docs);
    if (k === "jurados") return mountAssignments(panel, project);
  }
  activate("equipos");
}

/* --- detalles --- */
async function mountDetails(root, p) {
  const nameEl = el("input", { class: "input", value: p.name });
  const gradeEl = el("input", { class: "input", value: p.grade_label || "" });
  const descEl = el("textarea", { class: "textarea", value: p.description || "" });
  const errBox = el("div", { class: "error-banner", style: { display: "none", marginTop: "var(--space-3)" } });
  const saveBtn = el("button", { class: "btn btn--primary", text: "Guardar" });
  saveBtn.addEventListener("click", async () => {
    errBox.style.display = "none"; saveBtn.disabled = true;
    const orig = saveBtn.textContent; saveBtn.textContent = "Guardando…";
    try {
      const updated = await updateProject(p.id, {
        name: nameEl.value.trim(),
        grade_label: gradeEl.value.trim() || null,
        description: descEl.value.trim() || null,
      });
      Object.assign(p, updated);
      toast("Datos guardados", "success");
    } catch (e) {
      errBox.style.display = "block";
      errBox.textContent = "Error: " + (e?.message || JSON.stringify(e));
    } finally { saveBtn.disabled = false; saveBtn.textContent = orig; }
  });
  root.append(el("div", { class: "card" }, [
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Nombre" }), nameEl]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Grado / Grupo" }), gradeEl]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Descripción" }), descEl]),
    errBox, saveBtn,
  ]));
}

/* --- equipos (lista N) --- */
async function mountTeamsList(root, project, teams, scores) {
  root.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h3", { class: "card__title", style: { margin: 0 }, text: "Equipos del proyecto" }),
      el("p", { class: "text-muted", style: { margin: 0 }, text: `${teams.length} equipo(s) · cada uno se evalúa por separado` }),
    ]),
    el("button", { class: "btn btn--primary", text: "+ Nuevo equipo", onclick: openCreateTeam }),
  ]));

  if (!teams.length) {
    root.append(el("div", { class: "empty", text: "Aún no hay equipos. Crea el primero." }));
    return;
  }

  const grid = el("div", { class: "grid grid--cards" });
  root.append(grid);
  const scoreMap = Object.fromEntries((scores || []).map((s) => [s.team_id, s]));
  for (const t of teams) {
    const memberCount = (await listTeamMembers(t.id).catch(() => [])).length;
    const s = scoreMap[t.id] || {};
    grid.append(el("div", { class: "card" }, [
      el("div", { class: "card__title", text: t.name }),
      el("div", { class: "card__subtitle", text: [
        t.room && `Aula ${t.room}`,
        t.presentation_order != null && `Orden ${t.presentation_order}`,
        `${memberCount} integrante(s)`,
      ].filter(Boolean).join(" · ") || "Sin metadatos" }),
      el("div", { class: "tag-list mt-2" }, [
        el("span", { class: "pill pill--primary", text: `Sustentación: ${fmtScore(s.sustentation_avg ?? 0)}` }),
        el("span", { class: "pill pill--primary", text: `Concurso: ${fmtScore(s.field_contest_avg ?? 0)}` }),
        el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(s.total_score ?? 0)}` }),
      ]),
      el("div", { class: "btn-row mt-3" }, [
        el("a", { class: "btn btn--primary btn--sm", href: `#/admin/equipos/${t.id}`, text: "Editar →" }),
        el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
          const ok = await confirmDialog(`Se eliminará el equipo "${t.name}" con todos sus integrantes, evaluaciones y fotos.`, { okLabel: "Eliminar", danger: true });
          if (!ok) return;
          try { await deleteTeam(t.id); toast("Equipo eliminado", "success"); renderAdmin({ section: "proyecto", projectId: project.id }); }
          catch (e) { toast("Error: " + (e?.message || ""), "error"); }
        } }),
      ]),
    ]));
  }

  async function openCreateTeam() {
    const nameEl = el("input", { class: "input", placeholder: "Nombre del equipo (ej. LOS ROBOTS)" });
    const roomEl = el("input", { class: "input", placeholder: "Aula (ej. AUDIOVISUALES)" });
    const orderEl = el("input", { class: "input", type: "number", placeholder: "Orden de exposición" });
    const r = await openModal({
      title: `Nuevo equipo · ${project.name}`,
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Nombre del equipo" }), nameEl]),
        el("div", { class: "field-row field-row--2" }, [
          el("div", { class: "field" }, [el("label", { class: "field__label", text: "Aula" }), roomEl]),
          el("div", { class: "field" }, [el("label", { class: "field__label", text: "Orden" }), orderEl]),
        ]),
        el("p", { class: "field__hint", text: "Después podrás cargar los integrantes (manual o desde Excel/CSV/PDF)." }),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        { label: "Crear", variant: "primary", onClick: async () => {
          if (!nameEl.value.trim()) throw new Error("Nombre del equipo requerido");
          const team = await createTeam({
            projectId: project.id,
            name: nameEl.value.trim(),
            room: roomEl.value.trim() || null,
            presentationOrder: orderEl.value || null,
          });
          return team;
        } },
      ],
    });
    if (r && r.id) navigate("/admin/equipos/" + r.id);
  }
}

/* ---------------- Equipo · detalle (admin) ---------------- */
async function renderTeamAdmin(body, teamId) {
  if (!teamId) { body.append(el("div", { class: "empty", text: "Equipo inválido." })); return; }
  body.append(el("a", { class: "btn btn--ghost btn--sm", href: "#/admin/proyectos", text: "← Volver a proyectos" }));

  let bundle;
  try { bundle = await getTeamFull(teamId); }
  catch (e) { body.append(el("div", { class: "error-banner", text: "Error: " + (e?.message || "") })); return; }
  if (!bundle?.team) { body.append(el("div", { class: "empty", text: "Equipo no encontrado." })); return; }

  const { team, project, members, photos, score } = bundle;
  body.append(el("a", { class: "btn btn--ghost btn--sm mt-3", href: `#/admin/proyectos/${project.id}`, text: `← ${project.name}` }));
  body.append(el("h2", { class: "mt-3", text: team.name }));
  body.append(el("div", { class: "tag-list mb-4" }, [
    el("span", { class: "pill", text: project.name }),
    project.grade_label ? el("span", { class: "pill", text: `Grado ${project.grade_label}` }) : null,
    el("span", { class: "pill pill--primary", text: `Sustentación: ${fmtScore(score?.sustentation_avg ?? 0)}` }),
    el("span", { class: "pill pill--primary", text: `Concurso: ${fmtScore(score?.field_contest_avg ?? 0)}` }),
    el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(score?.total_score ?? 0)}` }),
  ]));

  const tabs = el("div", { class: "tabs" });
  ["info", "integrantes", "fotos"].forEach((k) => {
    tabs.append(el("button", { class: "tabs__btn", "data-key": k, text: { info: "Información", integrantes: "Integrantes", fotos: "Fotos" }[k], onclick: () => act(k) }));
  });
  body.append(tabs);
  const panel = el("div");
  body.append(panel);

  function act(k) {
    Array.from(tabs.children).forEach((b) => b.classList.toggle("is-active", b.dataset.key === k));
    clear(panel);
    if (k === "info") return mountTeamInfo(panel, team);
    if (k === "integrantes") return mountTeamMembers(panel, team, members);
    if (k === "fotos") return mountTeamPhotos(panel, team, photos);
  }
  act("info");
}

function mountTeamInfo(root, team) {
  const nameEl = el("input", { class: "input", value: team.name });
  const roomEl = el("input", { class: "input", value: team.room || "" });
  const orderEl = el("input", { class: "input", type: "number", value: team.presentation_order ?? "" });
  const gradeEl = el("input", { class: "input", value: team.grade_label || "" });
  const descEl = el("textarea", { class: "textarea", value: team.description || "" });
  const errBox = el("div", { class: "error-banner", style: { display: "none", marginTop: "var(--space-3)" } });
  const saveBtn = el("button", { class: "btn btn--primary", text: "Guardar información" });
  saveBtn.addEventListener("click", async () => {
    errBox.style.display = "none"; saveBtn.disabled = true;
    const orig = saveBtn.textContent; saveBtn.textContent = "Guardando…";
    try {
      const updated = await updateTeam(team.id, {
        name: nameEl.value.trim(),
        room: roomEl.value.trim() || null,
        presentation_order: orderEl.value === "" ? null : Number(orderEl.value),
        grade_label: gradeEl.value.trim() || null,
        description: descEl.value.trim() || null,
      });
      Object.assign(team, updated);
      toast("Equipo actualizado", "success");
    } catch (e) {
      errBox.style.display = "block";
      errBox.textContent = "Error: " + (e?.message || JSON.stringify(e));
    } finally { saveBtn.disabled = false; saveBtn.textContent = orig; }
  });
  root.append(el("div", { class: "card" }, [
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Nombre del equipo" }), nameEl]),
    el("div", { class: "field-row field-row--3" }, [
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Aula" }), roomEl]),
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Orden de exposición" }), orderEl]),
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Grado (opcional)" }), gradeEl]),
    ]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Descripción del equipo (opcional)" }), descEl]),
    errBox, saveBtn,
  ]));
}

function mountTeamMembers(root, team, initialMembers) {
  let members = (initialMembers || []).map((m) => ({ full_name: m.full_name }));
  const list = el("div", { class: "flex-col gap-2 mt-3" });
  const errBox = el("div", { class: "error-banner", style: { display: "none", marginTop: "var(--space-3)" } });

  function paint() {
    clear(list);
    if (!members.length) list.append(el("div", { class: "empty", text: "Aún no hay integrantes." }));
    members.forEach((m, i) => {
      const inp = el("input", { class: "input", value: m.full_name, oninput: (e) => (members[i].full_name = e.target.value) });
      const del = el("button", { class: "btn btn--danger btn--sm", text: "✕", onclick: () => { members.splice(i, 1); paint(); } });
      list.append(el("div", { class: "flex gap-2 items-center" }, [inp, del]));
    });
  }
  paint();

  const fileInput = el("input", { type: "file", accept: ".csv,.xlsx,.xls,.pdf", style: { display: "none" } });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try {
      const parsed = await parseFile(file);
      members = members.concat(parsed.map((m) => ({ full_name: m.full_name })));
      paint();
      toast(`Importados ${parsed.length} nombres`, "success");
    } catch (e) { toast("No se pudo leer el archivo: " + (e?.message || ""), "error"); }
    finally { fileInput.value = ""; }
  });

  const saveBtn = el("button", { class: "btn btn--primary", text: "Guardar integrantes" });
  saveBtn.addEventListener("click", async () => {
    errBox.style.display = "none"; saveBtn.disabled = true;
    const orig = saveBtn.textContent; saveBtn.textContent = "Guardando…";
    try {
      const clean = members.filter((m) => m.full_name?.trim()).map((m) => ({ full_name: m.full_name.trim() }));
      await replaceTeamMembers(team.id, clean);
      const fresh = await listTeamMembers(team.id);
      members = fresh.map((m) => ({ full_name: m.full_name }));
      paint();
      toast(`Guardado: ${members.length} integrante(s)`, "success");
    } catch (e) {
      errBox.style.display = "block";
      errBox.textContent = "Error: " + (e?.message || JSON.stringify(e));
    } finally { saveBtn.disabled = false; saveBtn.textContent = orig; }
  });

  root.append(el("div", { class: "card" }, [
    el("div", { class: "section-head" }, [
      el("h4", { text: "Integrantes" }),
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn btn--ghost", text: "+ Integrante", onclick: () => { members.push({ full_name: "" }); paint(); } }),
        el("button", { class: "btn btn--ghost", text: "Importar (CSV/XLSX/PDF)", onclick: () => fileInput.click() }),
      ]),
    ]),
    list,
    fileInput,
    errBox,
    el("div", { class: "btn-row mt-4" }, [saveBtn]),
  ]));
}

async function mountTeamPhotos(root, team, initialPhotos) {
  let photos = [...(initialPhotos || [])];
  const grid = el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" } });
  async function paint() {
    clear(grid);
    if (!photos.length) { grid.append(el("div", { class: "empty", style: { gridColumn: "1/-1" }, text: "Sin fotos." })); return; }
    for (const p of photos) {
      const url = await signedPhotoUrl(p.storage_path).catch(() => null);
      const box = el("div", { style: { position: "relative", aspectRatio: "1/1", borderRadius: "12px", overflow: "hidden", background: "#000" } });
      if (url) box.append(el("img", { src: url, alt: "", loading: "lazy", style: { width: "100%", height: "100%", objectFit: "cover" } }));
      box.append(el("button", { class: "btn btn--danger btn--sm", style: { position: "absolute", right: "6px", top: "6px" }, text: "✕", onclick: async () => {
        const ok = await confirmDialog("¿Eliminar foto?", { okLabel: "Eliminar", danger: true });
        if (!ok) return;
        try { await deleteTeamPhoto(p); photos = photos.filter((x) => x.id !== p.id); paint(); }
        catch (e) { toast("Error: " + (e?.message || ""), "error"); }
      } }));
      grid.append(box);
    }
  }
  paint();

  const fileInput = el("input", { type: "file", accept: "image/*", multiple: true, style: { display: "none" } });
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    for (const f of files) {
      try { const ph = await uploadTeamPhoto({ teamId: team.id, file: f }); photos.push(ph); }
      catch (e) { toast("Error subiendo: " + (e?.message || ""), "error"); }
    }
    fileInput.value = ""; paint(); toast(`Subidas ${files.length} foto(s)`, "success");
  });

  root.append(el("div", { class: "card" }, [
    el("div", { class: "section-head" }, [
      el("h4", { text: "Fotos del equipo" }),
      el("button", { class: "btn btn--primary btn--sm", text: "+ Subir fotos", onclick: () => fileInput.click() }),
    ]),
    grid, fileInput,
  ]));
}

/* --- evaluación (configs por proyecto) --- */
async function mountConfigs(root, project, configs) {
  const fresh = await listConfigs(project.id).catch(() => configs || []);
  ["sustentation", "field_contest"].forEach((phase) => {
    const active = fresh.find((c) => c.phase === phase && c.is_active);
    root.append(configEditor(project, phase, active));
  });
}

function configEditor(project, phase, current) {
  const card = el("div", { class: "card mt-4" }, [
    el("h3", { class: "card__title", text: phase === "sustentation" ? "Sustentación" : "Concurso de campo" }),
    el("p", { class: "text-muted", style: { fontSize: "0.85rem" }, text: "Esta configuración aplica a todos los equipos del proyecto." }),
  ]);
  const methodOptions = phase === "sustentation"
    ? [
        ["questionnaire", "Solo cuestionario"],
        ["interview", "Solo entrevista"],
        ["questionnaire_interview", "Cuestionario + Entrevista"],
        ["process_phases", "Fases del proceso"],
        ["process_phases_interview", "Fases + Entrevista"],
      ]
    : [["field_rounds", "Rondas de concurso"]];
  const methodEl = el("select", { class: "select" });
  methodOptions.forEach(([v, l]) => methodEl.append(el("option", { value: v, text: l, selected: current?.method_type === v })));
  const minEl = el("input", { class: "input", type: "number", value: current?.scale_min ?? 0 });
  const maxEl = el("input", { class: "input", type: "number", value: current?.scale_max ?? 5 });
  const jsonEl = el("textarea", {
    class: "textarea",
    style: { fontFamily: "var(--font-mono)", minHeight: "180px" },
    value: JSON.stringify(current?.config || templateForMethod(current?.method_type || methodEl.value), null, 2),
  });
  methodEl.addEventListener("change", () => {
    if (!confirm("¿Reemplazar la configuración con la plantilla del nuevo método?")) return;
    jsonEl.value = JSON.stringify(templateForMethod(methodEl.value), null, 2);
  });
  card.append(
    el("div", { class: "field-row field-row--3" }, [
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Metodología" }), methodEl]),
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Escala mín." }), minEl]),
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Escala máx." }), maxEl]),
    ]),
    el("div", { class: "field" }, [
      el("label", { class: "field__label", text: "Configuración (JSON)" }),
      el("p", { class: "field__hint", text: "Edita preguntas, fases o rondas. Cada equipo se evalúa con esta misma configuración." }),
      jsonEl,
    ]),
    el("div", { class: "btn-row" }, [
      (() => {
        const btn = el("button", { class: "btn btn--primary", text: "Guardar configuración" });
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          let cfg;
          try { cfg = JSON.parse(jsonEl.value); }
          catch (e) { return toast("JSON inválido: " + e.message, "error"); }
          btn.disabled = true;
          const original = btn.textContent;
          btn.textContent = "Guardando…";
          try {
            await upsertActiveConfig({
              projectId: project.id, phase,
              methodType: methodEl.value,
              scaleMin: Number(minEl.value), scaleMax: Number(maxEl.value),
              config: cfg,
            });
            toast("Configuración guardada", "success");
          } catch (e) {
            toast("Error: " + (e?.message || ""), "error");
          } finally {
            btn.disabled = false;
            btn.textContent = original;
          }
        });
        return btn;
      })(),
      el("button", { class: "btn btn--ghost", text: "Restaurar plantilla", onclick: () => {
        jsonEl.value = JSON.stringify(templateForMethod(methodEl.value), null, 2);
      } }),
    ]),
  );
  return card;
}

function templateForMethod(m) {
  const id = () => Math.random().toString(36).slice(2, 8);
  if (m === "questionnaire") return {
    randomPickCount: 0,
    questions: [
      { id: id(), prompt: "¿Cómo definiste el problema?", maxScore: 5, requiresObservation: true },
      { id: id(), prompt: "¿Qué evidencias tomaste?", maxScore: 5, requiresObservation: true },
    ],
  };
  if (m === "interview") return { questions: [{ id: id(), prompt: "Cuéntanos tu proyecto en 3 minutos.", maxScore: 10, requiresObservation: true }] };
  if (m === "questionnaire_interview") return {
    questionnaire: { randomPickCount: 0, questions: [{ id: id(), prompt: "Pregunta del cuestionario", maxScore: 5, requiresObservation: true }] },
    interview: { questions: [{ id: id(), prompt: "Pregunta abierta", maxScore: 10, requiresObservation: true }] },
  };
  if (m === "process_phases") return {
    phases: [
      { id: "analysis", label: "Análisis", maxScore: 5, requiresObservation: true },
      { id: "design", label: "Diseño", maxScore: 5, requiresObservation: true },
      { id: "build", label: "Construcción", maxScore: 5, requiresObservation: true },
      { id: "evaluation", label: "Evaluación", maxScore: 5, requiresObservation: true },
    ],
  };
  if (m === "process_phases_interview") return {
    phases: [{ id: "analysis", label: "Análisis", maxScore: 5, requiresObservation: true }, { id: "design", label: "Diseño", maxScore: 5, requiresObservation: true }],
    interview: { questions: [{ id: id(), prompt: "Pregunta abierta", maxScore: 10, requiresObservation: true }] },
  };
  if (m === "field_rounds") return {
    rounds: [{ id: "r1", title: "Ronda 1", description: "Reglas y descripción", maxScore: 20, modalities: [{ id: "speed", label: "Velocidad", maxScore: 10, requiresObservation: false }] }],
  };
  return {};
}

/* --- documentos --- */
async function mountDocs(root, project, docs) {
  const list = el("div", { class: "flex-col gap-2 mt-3" });
  async function paint() {
    clear(list);
    if (!docs.length) list.append(el("div", { class: "empty", text: "Sin documentos." }));
    for (const d of docs) {
      const url = await resolveDocUrl(d).catch(() => null);
      const icon = d.external_url ? "🔗" : "📄";
      const typeLabel = d.external_url ? "Enlace" : "Archivo";
      const meta = d.external_url
        ? new URL(d.external_url).hostname.replace(/^www\./, "")
        : (d.storage_path?.split("/").pop() || "");
      list.append(el("div", { class: "muted-card flex items-center justify-between gap-2" }, [
        el("div", { class: "flex-col" }, [
          el("a", { href: url || "#", target: "_blank", rel: "noopener", text: `${icon} ${d.title}` }),
          el("span", { class: "text-muted", style: { fontSize: "0.8rem" }, text: `${typeLabel} · ${meta}` }),
        ]),
        el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
          const ok = await confirmDialog("¿Eliminar este documento?", { okLabel: "Eliminar", danger: true });
          if (!ok) return;
          try { await deleteProjectDocument(d); docs = docs.filter((x) => x.id !== d.id); paint(); toast("Eliminado", "success"); }
          catch (e) { toast("Error: " + (e?.message || ""), "error"); }
        } }),
      ]));
    }
  }
  paint();
  const fileInput = el("input", { type: "file", accept: ".pdf,application/pdf,image/*", style: { display: "none" } });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    const title = prompt("Título del documento", file.name) || file.name;
    try { const d = await uploadProjectDocument({ projectId: project.id, file, title }); docs.push(d); paint(); toast("Documento subido", "success"); }
    catch (e) { toast("Error: " + (e?.message || ""), "error"); }
    finally { fileInput.value = ""; }
  });

  async function openAddLinkModal() {
    const titleInput = el("input", { class: "input", placeholder: "p. ej. Guía del proyecto" });
    const urlInput = el("input", { class: "input", type: "url", placeholder: "https://ejemplo.com/guia" });
    const form = el("div", { class: "flex-col gap-3" }, [
      el("label", { class: "field" }, [el("span", { text: "Título" }), titleInput]),
      el("label", { class: "field" }, [
        el("span", { text: "URL del enlace" }),
        urlInput,
        el("span", { class: "text-muted", style: { fontSize: "0.8rem" }, text: "Acepta páginas web, Google Docs, Drive, YouTube, etc." }),
      ]),
    ]);
    await openModal({
      title: "Agregar enlace al proyecto",
      body: form,
      actions: [
        { label: "Cancelar", onClick: () => null },
        {
          label: "Agregar",
          variant: "primary",
          onClick: async () => {
            const title = titleInput.value.trim();
            const url = urlInput.value.trim();
            if (!title) throw new Error("El título es obligatorio.");
            if (!url) throw new Error("La URL es obligatoria.");
            const d = await addProjectLink({ projectId: project.id, title, url });
            docs.push(d);
            paint();
            toast("Enlace agregado", "success");
            return true;
          },
        },
      ],
    });
  }

  root.append(el("div", { class: "card" }, [
    el("div", { class: "section-head" }, [
      el("h3", { class: "card__title", text: "Documentos y enlaces del proyecto" }),
      el("div", { class: "flex gap-2", style: { flexWrap: "wrap" } }, [
        el("button", { class: "btn btn--ghost btn--sm", text: "+ Agregar enlace", onclick: openAddLinkModal }),
        el("button", { class: "btn btn--primary btn--sm", text: "+ Subir archivo", onclick: () => fileInput.click() }),
      ]),
    ]),
    el("p", { class: "text-muted", style: { fontSize: "0.85rem" }, text: "Disponibles para todos los equipos del proyecto. Puedes subir archivos (PDF, imagen) o agregar enlaces a páginas web." }),
    list, fileInput,
  ]));
}

/* --- jurados (asignaciones a nivel proyecto) --- */
async function mountAssignments(root, project) {
  const ed = getCurrentEdition();
  const evaluators = await listEvaluators(ed.id).catch(() => []);
  const assignments = await listAssignmentsForEdition(ed.id).catch(() => []);
  const assigned = new Set(assignments.filter((a) => a.project_id === project.id).map((a) => a.evaluator_id));
  const list = el("div", { class: "flex-col gap-2 mt-3" });
  if (!evaluators.length) {
    list.append(el("div", { class: "empty", text: "Aún no hay jurados registrados en esta edición." }));
  } else {
    evaluators.forEach((ev) => {
      const cb = el("input", { type: "checkbox", checked: assigned.has(ev.id), onchange: async () => {
        try { await setAssignment({ projectId: project.id, evaluatorId: ev.id, assigned: cb.checked }); toast("Asignación actualizada", "success"); }
        catch (e) { toast("Error: " + (e?.message || ""), "error"); cb.checked = !cb.checked; }
      } });
      list.append(el("label", { class: "muted-card flex items-center gap-2" }, [
        cb, el("strong", { text: ev.profile?.display_name || "Jurado" }),
        el("span", { class: "text-muted", text: ev.active ? "" : "(inactivo)" }),
      ]));
    });
  }
  root.append(el("div", { class: "card" }, [
    el("h3", { class: "card__title", text: "Jurados asignados al proyecto" }),
    el("p", { class: "text-muted", style: { fontSize: "0.85rem" }, text: "Los jurados marcados podrán evaluar todos los equipos de este proyecto." }),
    list,
  ]));
}

/* ---------------- Jurados (sección global) ---------------- */
async function renderEvaluatorsAdmin(body) {
  const ed = getCurrentEdition();
  if (!ed) { body.append(el("div", { class: "empty", text: "Selecciona una edición." })); return; }
  body.append(el("div", { class: "section-head" }, [
    el("h2", { text: "Jurados" }),
    el("button", { class: "btn btn--primary", text: "Agregar jurado", onclick: openAdd }),
  ]));
  const list = el("div", { class: "flex-col gap-2" });
  body.append(list);
  let evs = [];
  try { evs = await listEvaluators(ed.id); }
  catch { list.append(el("div", { class: "error-banner", text: "Error cargando jurados" })); return; }
  if (!evs.length) { list.append(el("div", { class: "empty", text: "Sin jurados registrados en esta edición." })); return; }
  evs.forEach((ev) => list.append(el("div", { class: "card" }, [
    el("div", { class: "flex items-center justify-between gap-3" }, [
      el("div", {}, [
        el("strong", { text: ev.profile?.display_name || "Jurado" }),
        el("div", { class: "text-muted", style: { fontSize: "0.85rem" }, text: ev.active ? "Activo" : "Inactivo" }),
      ]),
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn btn--ghost btn--sm", text: ev.active ? "Desactivar" : "Activar", onclick: async () => {
          const { error } = await supabase.from("evaluators").update({ active: !ev.active }).eq("id", ev.id);
          if (error) toast("Error: " + error.message, "error"); else { toast("Actualizado", "success"); renderAdmin({ section: "jurados" }); }
        } }),
        el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
          const ok = await confirmDialog("¿Eliminar este jurado de la edición? Sus evaluaciones se conservarán.", { okLabel: "Eliminar", danger: true });
          if (!ok) return;
          const { error } = await supabase.from("evaluators").delete().eq("id", ev.id);
          if (error) toast("Error: " + error.message, "error"); else { toast("Eliminado", "success"); renderAdmin({ section: "jurados" }); }
        } }),
      ]),
    ]),
  ])));

  async function openAdd() {
    const emailEl = el("input", { class: "input", type: "email", placeholder: "jurado@correo.com" });
    const help = el("p", { class: "field__hint", text: "El usuario debe haberse registrado previamente en la app (puede crear su cuenta en la pantalla #/admin con 'Crear cuenta nueva')." });
    const r = await openModal({
      title: "Agregar jurado por email",
      body: el("div", {}, [el("div", { class: "field" }, [el("label", { class: "field__label", text: "Correo del jurado" }), emailEl, help])]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        { label: "Agregar", variant: "primary", onClick: async () => {
          const email = emailEl.value.trim();
          if (!email) throw new Error("Email requerido");
          const { data, error } = await supabase.rpc("admin_add_evaluator_by_email", { p_edition_id: ed.id, p_email: email });
          if (error) throw error;
          if (!data?.ok) throw new Error(data?.error === "user_not_found" ? "No existe un usuario con ese email. Pídele que se registre primero." : `Error: ${data?.error || ""}`);
          return true;
        } },
      ],
    });
    if (r) renderAdmin({ section: "jurados" });
  }
}

/* ---------------- Ranking admin ---------------- */
async function renderRankingAdmin(body) {
  const ed = getCurrentEdition();
  if (!ed) { body.append(el("div", { class: "empty", text: "Selecciona una edición." })); return; }
  body.append(el("h2", { text: "Ranking en vivo" }));
  body.append(el("p", { class: "text-muted", text: "Ordenado por puntaje total. Empate: orden alfabético." }));
  const list = el("div", { class: "flex-col gap-3 mt-4" });
  body.append(list);
  try {
    const rows = await listRanking(ed.id);
    if (!rows.length) list.append(el("div", { class: "empty", text: "Sin puntajes aún." }));
    rows.forEach((r) => list.append(el("a", {
      class: "rank-row",
      href: `#/admin/equipos/${r.team_id}`,
      style: { textDecoration: "none", color: "inherit" },
    }, [
      el("div", { class: `rank-row__pos rank-row__pos--${r.edition_rank <= 3 ? r.edition_rank : ""}`, text: String(r.edition_rank) }),
      el("div", {}, [
        el("div", { class: "rank-row__title", text: `${r.team_name}` }),
        el("div", { class: "rank-row__meta", text: `${r.project_name} · Sustentación ${fmtScore(r.sustentation_avg)} · Concurso ${fmtScore(r.field_contest_avg)}` }),
      ]),
      el("div", { class: "rank-row__score" }, [`${fmtScore(r.total_score)}`, el("small", { text: "Total" })]),
    ])));
  } catch (e) { list.append(el("div", { class: "error-banner", text: "Error cargando ranking." })); }
}
