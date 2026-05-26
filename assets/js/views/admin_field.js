import { el, clear, toast, openModal, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import {
  listProjects, listEvaluators, listTeamsByProject,
  listFieldCompetitions, createFieldCompetition, updateFieldCompetition, deleteFieldCompetition,
} from "../data.js?v=19";

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
    const judgeName = comp.evaluator?.profile?.display_name || "Sin asignar";
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
            " · ",
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

    // Juez asignado
    card.append(
      el("div", {
        style: "padding:var(--space-3) var(--space-4);background:var(--color-surface-2);border-radius:var(--radius-sm);margin-bottom:var(--space-3)",
      }, [
        el("div", { class: "flex items-center", style: "justify-content:space-between;flex-wrap:wrap;gap:8px" }, [
          el("div", {}, [
            el("span", { class: "text-muted", style: "font-size:0.78rem;text-transform:uppercase;letter-spacing:.05em", text: "Juez de campo" }),
            el("p", { style: "margin:2px 0 0;font-weight:600", text: judgeName }),
          ]),
          el("button", {
            class: "btn btn--ghost btn--sm",
            text: "Cambiar juez",
            onclick: () => openAssignJudgeModal(comp),
          }),
        ]),
      ])
    );

    // Config resumen
    const configSummary = buildConfigSummary(comp.competition_type, comp.config);
    if (configSummary) card.append(configSummary);

    return card;
  }

  // ── Modal: crear competencia ──────────────────────────────────
  async function openCreateModal() {
    const projSelect = el("select", { class: "select" });
    availableProjects.forEach((p) =>
      projSelect.append(el("option", { value: p.id, text: p.name }))
    );

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
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Proyecto" }), projSelect]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Tipo de competencia" }), typeSelect, descEl]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Juez de campo (opcional)" }), judgeSelect]),
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
              await updateFieldCompetition(comp.id, { assigned_evaluator_id: judgeSelect.value });
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
    const typeSelect = el("select", { class: "select" });
    Object.entries(TYPE_LABELS).forEach(([k, v]) =>
      typeSelect.append(el("option", { value: k, text: v, selected: k === comp.competition_type }))
    );

    const configArea = el("textarea", {
      class: "textarea",
      style: "font-family:var(--font-mono);font-size:0.85rem;min-height:180px",
      value: JSON.stringify(comp.config || {}, null, 2),
    });

    typeSelect.addEventListener("change", () => {
      if (!configArea.value.trim() || configArea.value.trim() === "{}") {
        configArea.value = JSON.stringify(getDefaultConfig(typeSelect.value), null, 2);
      }
    });

    const statusSelect = el("select", { class: "select" });
    ["setup", "active", "finished"].forEach((s) =>
      statusSelect.append(el("option", { value: s, text: s === "setup" ? "En configuración" : s === "active" ? "En curso" : "Finalizada", selected: s === comp.status }))
    );

    const result = await openModal({
      title: "Editar competencia",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Tipo" }), typeSelect]),
        el("div", { class: "field" }, [el("label", { class: "field__label", text: "Estado" }), statusSelect]),
        el("div", { class: "field" }, [
          el("label", { class: "field__label", text: "Configuración (JSON)" }),
          configArea,
          el("span", { class: "field__hint", text: "Define puntos por posición, criterios, reglas de victoria, etc." }),
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

  // ── Modal: asignar/cambiar juez ───────────────────────────────
  async function openAssignJudgeModal(comp) {
    const judgeSelect = el("select", { class: "select" });
    judgeSelect.append(el("option", { value: "", text: "— Sin asignar —" }));
    evaluators.forEach((ev) =>
      judgeSelect.append(el("option", {
        value: ev.id,
        text: ev.profile?.display_name || `Jurado ${ev.id.slice(0, 6)}`,
        selected: ev.id === comp.assigned_evaluator_id,
      }))
    );

    const result = await openModal({
      title: "Asignar juez de campo",
      body: el("div", {}, [
        el("p", { class: "text-muted", text: `Competencia: ${comp.project?.name || "—"}` }),
        el("div", { class: "field mt-3" }, [el("label", { class: "field__label", text: "Juez asignado" }), judgeSelect]),
        el("p", { class: "field__hint", text: "Puedes cambiar el juez en cualquier momento, incluso durante la competencia. Los datos no se pierden." }),
      ]),
      actions: [
        { label: "Cancelar", onClick: () => null },
        {
          label: "Asignar", variant: "primary", onClick: async () => {
            await updateFieldCompetition(comp.id, {
              assigned_evaluator_id: judgeSelect.value || null,
            });
            return true;
          },
        },
      ],
    });
    if (result) { toast("Juez actualizado", "success"); renderFieldAdmin(body); }
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
