import { el, clear, toast, openModal, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import {
  listProjects, listEvaluators, listTeamsByProject,
  listFieldCompetitions, createFieldCompetition, updateFieldCompetition, deleteFieldCompetition,
  listCompetitionJudges, addCompetitionJudge, removeCompetitionJudge,
} from "../data.js?v=19";

// Cache de conteo de equipos por proyecto
const teamCountCache = {};

/* ================================================================
   Admin: Pruebas de Campo – Configurar competencias y asignar jueces
   ================================================================ */

const TYPE_LABELS = {
  time_trial: "Prueba de tiempo",
  performance: "Desempeño con criterios",
  combat: "Combate / Enfrentamiento",
  elimination: "Eliminación progresiva",
  timed_quantity: "Cantidad en tiempo",
};

const TYPE_DESCRIPTIONS = {
  time_trial: "Menor tiempo → posición → puntos por puesto (ej. seguidor de línea)",
  performance: "Puntos acumulables por eventos/criterios (ej. performance de piano)",
  combat: "Victoria/empate/derrota entre pares (ej. sumo)",
  elimination: "Rondas progresivas, eliminados conservan sus puntos (ej. canicas modalidad 1)",
  timed_quantity: "Mover N objetos en menor tiempo, por rondas (ej. canicas modalidad 2)",
};

export async function renderFieldAdmin(body) {
  clear(body);
  const ed = getCurrentEdition();
  if (!ed) { body.append(el("div", { class: "empty", text: "Selecciona una edición." })); return; }

  body.append(el("div", { class: "loading-screen" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", { text: "Cargando competencias de campo…" }),
  ]));

  let projects, evaluators, competitions;
  try {
    [projects, evaluators, competitions] = await Promise.all([
      listProjects(ed.id),
      listEvaluators(ed.id),
      listFieldCompetitions(ed.id),
    ]);
    // Pre-cargar conteo de equipos
    await Promise.all(projects.map(async (p) => {
      if (!teamCountCache[p.id]) {
        try { const t = await listTeamsByProject(p.id); teamCountCache[p.id] = t.length; } catch { teamCountCache[p.id] = 0; }
      }
    }));
  } catch (err) {
    clear(body);
    body.append(el("div", { class: "error-banner", text: "Error: " + (err?.message || err) }));
    return;
  }
  clear(body);

  // Proyectos sin competencia asignada
  const usedProjectIds = new Set(competitions.map((c) => c.project_id));
  const availableProjects = projects.filter((p) => !usedProjectIds.has(p.id));

  // ── Encabezado + botón crear ──────────────────────────────────
  body.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: "Pruebas de campo" }),
        el("p", { class: "text-muted", text: `${competitions.length} competencia${competitions.length !== 1 ? "s" : ""} configurada${competitions.length !== 1 ? "s" : ""} · ${availableProjects.length} proyecto${availableProjects.length !== 1 ? "s" : ""} sin competencia` }),
      ]),
      availableProjects.length
        ? el("button", {
            class: "btn btn--primary",
            text: "+ Crear competencia",
            onclick: () => openCreateModal(),
          })
        : null,
    ])
  );

  // ── Lista de competencias ─────────────────────────────────────
  const list = el("div", { class: "flex-col gap-4 mt-4" });
  body.append(list);

  if (!competitions.length) {
    list.append(el("div", { class: "empty", text: "No hay competencias configuradas. Crea una para empezar." }));
  } else {
    competitions.forEach((comp) => list.append(competitionCard(comp)));
  }

  // ── Card de una competencia ───────────────────────────────────
  function competitionCard(comp) {
    const projName = comp.project?.name || "—";
    const teamsInComp = teamCountCache[comp.project_id] ?? "?";
    const statusColors = { setup: "var(--color-warning)", active: "var(--color-accent)", finished: "var(--color-text-muted)" };
    const statusLabels = { setup: "En configuración", active: "En curso", finished: "Finalizada" };

    const card = el("div", { class: "card" });

    // Header
    card.append(
      el("div", {
        class: "flex items-center",
        style: "justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);margin-bottom:var(--space-3)",
      }, [
        el("div", {}, [
          el("h3", { class: "card__title", style: "margin:0", text: projName }),
          el("p", { class: "text-muted", style: "margin:4px 0 0;font-size:0.85rem" }, [
            TYPE_LABELS[comp.competition_type] || comp.competition_type,
            ` · ${teamsInComp} equipos · `,
            el("span", { style: `color:${statusColors[comp.status]};font-weight:600`, text: statusLabels[comp.status] }),
          ]),
        ]),
        el("div", { class: "flex gap-2", style: "flex-wrap:wrap" }, [
          comp.status === "setup"
            ? el("button", {
                class: "btn btn--accent btn--sm",
                text: "Activar",
                onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  try {
                    await updateFieldCompetition(comp.id, { status: "active" });
                    toast("Competencia activada", "success");
                    renderFieldAdmin(body);
                  } catch (err) { toast("Error: " + err?.message, "error"); }
                },
              })
            : null,
          comp.status === "active"
            ? el("button", {
                class: "btn btn--ghost btn--sm",
                text: "Finalizar",
                onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  try {
                    await updateFieldCompetition(comp.id, { status: "finished" });
                    toast("Competencia finalizada", "success");
                    renderFieldAdmin(body);
                  } catch (err) { toast("Error: " + err?.message, "error"); }
                },
              })
            : null,
          el("button", {
            class: "btn btn--ghost btn--sm",
            text: "Editar",
            onclick: () => openEditModal(comp),
          }),
          el("button", {
            class: "btn btn--danger btn--sm",
            text: "Eliminar",
            onclick: async () => {
              const ok = await openModal({
                title: "Eliminar competencia",
                body: el("p", { class: "text-muted", text: `¿Eliminar la competencia de "${projName}"? Se borrarán todas sus rondas y resultados.` }),
                actions: [
                  { label: "Cancelar", onClick: () => false },
                  { label: "Eliminar", variant: "danger", onClick: () => true },
                ],
              });
              if (ok) {
                try {
                  await deleteFieldCompetition(comp.id);
                  toast("Competencia eliminada", "success");
                  renderFieldAdmin(body);
                } catch (err) { toast("Error: " + err?.message, "error"); }
              }
            },
          }),
        ]),
      ])
    );

    // Jueces asignados (multi-juez)
    const judgesSection = el("div", {
      style: "padding:var(--space-3) var(--space-4);background:var(--color-surface-2);border-radius:var(--radius-sm);margin-bottom:var(--space-3)",
    });
    card.append(judgesSection);
    loadJudgesSection(comp, judgesSection);

    // Config resumen
    const configSummary = buildConfigSummary(comp.competition_type, comp.config);
    if (configSummary) card.append(configSummary);

    return card;
  }

  async function loadJudgesSection(comp, container) {
    clear(container);
    container.append(el("span", { class: "text-muted", style: "font-size:0.8rem", text: "Cargando jueces…" }));
    let judges = [];
    try { judges = await listCompetitionJudges(comp.id); } catch {}
    clear(container);

    container.append(
      el("div", { class: "flex items-center", style: "justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px" }, [
        el("span", { class: "text-muted", style: "font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em", text: `Jueces de campo (${judges.length})` }),
        el("button", {
          class: "btn btn--accent btn--sm",
          text: "+ Agregar juez",
          onclick: () => openAddJudgeModal(comp, container),
        }),
      ])
    );

    if (!judges.length) {
      container.append(el("p", { style: "margin:0;font-size:0.85rem;color:var(--color-text-muted)", text: "Sin jueces asignados" }));
    } else {
      judges.forEach((j) => {
        const name = j.evaluator?.profile?.display_name || `Jurado ${j.evaluator_id.slice(0, 6)}`;
        container.append(
          el("div", { class: "flex items-center", style: "justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--color-border)" }, [
            el("span", { style: "font-weight:600;font-size:0.9rem", text: name }),
            el("button", {
              class: "btn btn--danger btn--sm",
              text: "Quitar",
              style: "font-size:0.75rem;padding:2px 8px",
              onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await removeCompetitionJudge(comp.id, j.evaluator_id);
                  toast(`${name} removido`, "success");
                  loadJudgesSection(comp, container);
                } catch (err) { toast("Error: " + err?.message, "error"); }
              },
            }),
          ])
        );
      });
    }
  }

  async function openAddJudgeModal(comp, judgesContainer) {
    let currentJudges = [];
    try { currentJudges = await listCompetitionJudges(comp.id); } catch {}
    const assignedIds = new Set(currentJudges.map((j) => j.evaluator_id));
    const available = evaluators.filter((ev) => !assignedIds.has(ev.id));

    if (!available.length) {
      toast("Todos los jurados ya están asignados a esta competencia", "warning");
      return;
    }

    const judgeSelect = el("select", { class: "select" });
    available.forEach((ev) =>
      judgeSelect.append(el("option", { value: ev.id, text: ev.profile?.display_name || `Jurado ${ev.id.slice(0, 6)}` }))
    );

    const result = await openModal({
      title: "Agregar juez de campo",
      body: el("div", {}, [
        el("p", { class: "text-muted", text: `Competencia: ${comp.project?.name || "—"}` }),
        el("p", { class: "text-muted", style: "font-size:0.83rem", text: `${currentJudges.length} juez/jueces ya asignados` }),
        el("div", { class: "field mt-3" }, [el("label", { class: "field__label", text: "Seleccionar juez" }), judgeSelect]),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        {
          label: "Agregar", variant: "primary", onClick: async () => {
            if (!judgeSelect.value) throw new Error("Selecciona un juez.");
            await addCompetitionJudge(comp.id, judgeSelect.value);
            return true;
          },
        },
      ],
    });
    if (result) {
      toast("Juez agregado", "success");
      loadJudgesSection(comp, judgesContainer);
    }
  }

  // ── Modal: crear competencia ──────────────────────────────────
  async function openCreateModal() {
    const projSelect = el("select", { class: "select" });
    availableProjects.forEach((p) =>
      projSelect.append(el("option", { value: p.id, text: p.name }))
    );

    // Indicador de equipos
    const teamInfoEl = el("div", {
      style: "background:var(--color-surface-2);padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);margin-top:6px;font-size:0.85rem",
    });
    async function updateTeamInfo() {
      const pid = projSelect.value;
      if (!pid) { teamInfoEl.textContent = ""; return; }
      if (!teamCountCache[pid]) {
        try { const t = await listTeamsByProject(pid); teamCountCache[pid] = t.length; }
        catch { teamCountCache[pid] = 0; }
      }
      teamInfoEl.innerHTML = "";
      teamInfoEl.append(el("span", { style: "font-weight:600;color:var(--color-accent)", text: `${teamCountCache[pid]} equipos` }));
      teamInfoEl.append(el("span", { class: "text-muted", text: " participan en este proyecto" }));
    }
    projSelect.addEventListener("change", updateTeamInfo);
    updateTeamInfo();

    const typeSelect = el("select", { class: "select" });
    Object.entries(TYPE_LABELS).forEach(([k, v]) =>
      typeSelect.append(el("option", { value: k, text: v }))
    );

    const descEl = el("p", { class: "text-muted", style: "font-size:0.83rem;margin-top:4px", text: TYPE_DESCRIPTIONS[typeSelect.value] });
    typeSelect.addEventListener("change", () => { descEl.textContent = TYPE_DESCRIPTIONS[typeSelect.value] || ""; });

    const judgeSelect = el("select", { class: "select" });
    judgeSelect.append(el("option", { value: "", text: "— Sin asignar por ahora —" }));
    evaluators.forEach((ev) =>
      judgeSelect.append(el("option", { value: ev.id, text: ev.profile?.display_name || `Jurado ${ev.id.slice(0, 6)}` }))
    );

    const result = await openModal({
      title: "Crear competencia de campo",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Proyecto" }), projSelect, teamInfoEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Tipo de competencia" }), typeSelect, descEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Juez de campo (opcional)" }), judgeSelect]),
        el("p", { class: "field__hint", style: "margin-top:var(--space-2)", text: "Después de crear, usa 'Editar' para configurar cuántos puestos puntúan y el valor de cada puesto." }),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        {
          label: "Crear", variant: "primary", onClick: async () => {
            if (!projSelect.value) throw new Error("Selecciona un proyecto.");
            const comp = await createFieldCompetition({
              projectId: projSelect.value,
              editionId: ed.id,
              competitionType: typeSelect.value,
              config: getDefaultConfig(typeSelect.value),
            });
            if (judgeSelect.value) {
              await addCompetitionJudge(comp.id, judgeSelect.value);
            }
            return true;
          },
        },
      ],
    });
    if (result) renderFieldAdmin(body);
  }

  // ── Modal: editar competencia (tipo + config) ─────────────────
  async function openEditModal(comp) {
    // Contar equipos del proyecto
    let teamCount = teamCountCache[comp.project_id];
    if (teamCount == null) {
      try { const t = await listTeamsByProject(comp.project_id); teamCount = t.length; teamCountCache[comp.project_id] = teamCount; }
      catch { teamCount = "?"; }
    }

    const typeSelect = el("select", { class: "select" });
    Object.entries(TYPE_LABELS).forEach(([k, v]) =>
      typeSelect.append(el("option", { value: k, text: v, selected: k === comp.competition_type }))
    );

    const statusSelect = el("select", { class: "select" });
    ["setup", "active", "finished"].forEach((s) =>
      statusSelect.append(el("option", { value: s, text: s === "setup" ? "En configuración" : s === "active" ? "En curso" : "Finalizada", selected: s === comp.status }))
    );

    // Sección visual de puntos por posición (para time_trial y timed_quantity)
    const currentConfig = comp.config || {};
    const isPositionBased = ["time_trial", "timed_quantity"].includes(comp.competition_type);
    const positionsData = isPositionBased
      ? (comp.competition_type === "time_trial" ? (currentConfig.positions || []) : (currentConfig.points_by_position || []).map((pts, i) => ({ place: i + 1, points: pts })))
      : [];

    const posContainer = el("div", { class: "field" });
    const configArea = el("textarea", {
      class: "textarea",
      style: "font-family:var(--font-mono);font-size:0.85rem;min-height:120px",
      value: JSON.stringify(currentConfig, null, 2),
    });

    function buildPositionEditor() {
      clear(posContainer);
      const cType = typeSelect.value;
      if (!["time_trial", "timed_quantity"].includes(cType)) {
        posContainer.style.display = "none";
        return;
      }
      posContainer.style.display = "";

      posContainer.append(
        el("label", { class: "field__label", text: "Puestos que puntúan" }),
        el("div", {
          style: "background:var(--color-surface-2);padding:var(--space-3);border-radius:var(--radius-sm);margin-bottom:var(--space-2)",
        }, [
          el("p", { style: "margin:0 0 8px;font-weight:600;color:var(--color-accent)", text: `Este proyecto tiene ${teamCount} equipos participando` }),
          el("p", { class: "text-muted", style: "margin:0;font-size:0.82rem", text: "Define cuántos puestos puntúan y el valor de cada puesto. Los puestos sin puntos asignados reciben 0." }),
        ])
      );

      const posListEl = el("div", { class: "flex-col gap-2", style: "margin-top:var(--space-2)" });
      posContainer.append(posListEl);

      // Leer posiciones actuales del textarea
      let parsed;
      try { parsed = JSON.parse(configArea.value); } catch { parsed = currentConfig; }
      let positions = [];
      if (cType === "time_trial") positions = parsed.positions || [];
      else positions = (parsed.points_by_position || []).map((pts, i) => ({ place: i + 1, points: pts }));

      positions.forEach((pos, idx) => {
        posListEl.append(buildPosRow(pos, idx));
      });

      // Botón agregar puesto
      posContainer.append(el("button", {
        class: "btn btn--ghost btn--sm mt-2",
        text: "+ Agregar puesto",
        onclick: () => {
          const nextPlace = positions.length + 1;
          positions.push({ place: nextPlace, points: 0 });
          posListEl.append(buildPosRow(positions[positions.length - 1], positions.length - 1));
          syncPosToConfig();
        },
      }));

      function buildPosRow(pos, idx) {
        const ptsInput = el("input", {
          type: "number", min: "0", step: "1", class: "input", style: "width:80px",
          value: String(pos.points),
          onchange: (e) => { positions[idx].points = parseInt(e.target.value) || 0; syncPosToConfig(); },
        });
        const removeBtn = el("button", {
          class: "btn btn--danger btn--sm", text: "✗",
          onclick: () => { positions.splice(idx, 1); buildPositionEditor(); syncPosToConfig(); },
        });
        return el("div", { class: "flex items-center gap-2" }, [
          el("span", { style: "width:40px;font-weight:600;font-size:0.9rem", text: `${pos.place}°` }),
          ptsInput,
          el("span", { class: "text-muted", style: "font-size:0.82rem", text: "puntos" }),
          removeBtn,
        ]);
      }

      function syncPosToConfig() {
        let parsed;
        try { parsed = JSON.parse(configArea.value); } catch { parsed = {}; }
        if (cType === "time_trial") {
          parsed.positions = positions.map((p, i) => ({ place: i + 1, points: p.points }));
        } else {
          parsed.points_by_position = positions.map((p) => p.points);
        }
        configArea.value = JSON.stringify(parsed, null, 2);
      }
    }

    typeSelect.addEventListener("change", () => {
      if (!configArea.value.trim() || configArea.value.trim() === "{}") {
        configArea.value = JSON.stringify(getDefaultConfig(typeSelect.value), null, 2);
      }
      buildPositionEditor();
    });

    buildPositionEditor();

    const result = await openModal({
      title: "Editar competencia",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Tipo" }), typeSelect]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Estado" }), statusSelect]),
        posContainer,
        el("div", { class: "field" }, [
          el("label", { class: "field__label", text: "Configuración avanzada (JSON)" }),
          configArea,
          el("span", { class: "field__hint", text: "Edita directamente si necesitas configurar criterios, reglas de combate, etc." }),
        ]),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        {
          label: "Guardar", variant: "primary", onClick: async () => {
            let parsed;
            try { parsed = JSON.parse(configArea.value); } catch { throw new Error("El JSON de configuración no es válido."); }
            await updateFieldCompetition(comp.id, {
              competition_type: typeSelect.value,
              config: parsed,
              status: statusSelect.value,
            });
            return true;
          },
        },
      ],
    });
    if (result) { toast("Competencia actualizada", "success"); renderFieldAdmin(body); }
  }

}

// ── Configuración por defecto según tipo ─────────────────────────
function getDefaultConfig(type) {
  switch (type) {
    case "time_trial":
      return {
        positions: [
          { place: 1, points: 10 },
          { place: 2, points: 7 },
          { place: 3, points: 5 },
          { place: 4, points: 3 },
          { place: 5, points: 1 },
        ],
        unit: "seconds",
        lower_is_better: true,
      };
    case "performance":
      return {
        events: [
          { key: "event_1", label: "Evento 1", points: 2 },
          { key: "event_2", label: "Evento 2", points: 1 },
        ],
      };
    case "combat":
      return { win_points: 3, draw_points: 1, loss_points: 0 };
    case "elimination":
      return { points_per_round_survived: 2 };
    case "timed_quantity":
      return {
        quantity: 10,
        unit: "seconds",
        lower_is_better: true,
        points_by_position: [5, 3, 2, 1],
      };
    default:
      return {};
  }
}

// ── Resumen visual de la config ─────────────────────────────────
function buildConfigSummary(type, config) {
  if (!config || !Object.keys(config).length) return null;
  const wrap = el("div", { style: "font-size:0.83rem;color:var(--color-text-muted);padding:0 var(--space-2)" });

  if (type === "time_trial" && config.positions?.length) {
    wrap.append(el("p", { style: "margin:0", text: `Puntos por posición: ${config.positions.map((p) => `${p.place}°=${p.points}pts`).join(", ")}` }));
  } else if (type === "performance" && config.events?.length) {
    wrap.append(el("p", { style: "margin:0", text: `Criterios: ${config.events.map((e) => `${e.label} (${e.points}pts)`).join(", ")}` }));
  } else if (type === "combat") {
    wrap.append(el("p", { style: "margin:0", text: `Victoria: ${config.win_points}pts · Empate: ${config.draw_points}pts · Derrota: ${config.loss_points}pts` }));
  } else if (type === "elimination") {
    wrap.append(el("p", { style: "margin:0", text: `${config.points_per_round_survived}pts por ronda superada` }));
  } else if (type === "timed_quantity") {
    wrap.append(el("p", { style: "margin:0", text: `${config.quantity} objetos · Puntos: ${(config.points_by_position || []).join(", ")}` }));
  }

  return wrap;
}
