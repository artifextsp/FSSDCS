import { el, clear, toast, openModal, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import {
  listProjects, listEvaluators, listTeamsByProject,
  listFieldCompetitions, createFieldCompetition, updateFieldCompetition, deleteFieldCompetition,
  listCompetitionJudges, addCompetitionJudge, removeCompetitionJudge,
} from "../data.js?v=19";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script"); s.src = src;
    s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}
async function loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf;
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js");
  return window.jspdf;
}

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
            text: "📄 PDF Jueces",
            onclick: (e) => generateJudgePDF(e.currentTarget, comp),
          }),
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

// ── Generar PDF informativo para los jueces de campo ─────────────
async function generateJudgePDF(btn, comp) {
  btn.disabled = true;
  btn.textContent = "Generando…";
  try {
    const [judges, teams] = await Promise.all([
      listCompetitionJudges(comp.id),
      listTeamsByProject(comp.project_id),
    ]);

    const { jsPDF } = await loadJsPDF();
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 20;

    const projName = comp.project?.name || "Competencia";
    const typeName = TYPE_LABELS[comp.competition_type] || comp.competition_type;
    const config = comp.config || {};

    // ── Encabezado ──
    doc.setFontSize(18);
    doc.setFont(undefined, "bold");
    doc.text("FERIA STEAM – Prueba de Campo", pageW / 2, y, { align: "center" });
    y += 10;
    doc.setFontSize(14);
    doc.text(projName.toUpperCase(), pageW / 2, y, { align: "center" });
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.text(`Tipo: ${typeName}`, pageW / 2, y, { align: "center" });
    y += 6;
    doc.text(`Equipos participantes: ${teams.length}`, pageW / 2, y, { align: "center" });
    y += 10;

    // ── Descripción del tipo ──
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("DESCRIPCIÓN DE LA COMPETENCIA", margin, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);

    const desc = TYPE_DESCRIPTIONS[comp.competition_type] || "Competencia de campo.";
    const descLines = doc.splitTextToSize(desc, pageW - margin * 2);
    doc.text(descLines, margin, y);
    y += descLines.length * 5 + 4;

    // ── Sistema de puntuación ──
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("SISTEMA DE PUNTUACIÓN", margin, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);

    if (comp.competition_type === "time_trial") {
      doc.text("Se registra el tiempo de cada equipo. Menor tiempo = mejor posición.", margin, y);
      y += 5;
      doc.text("Puntos por posición:", margin, y);
      y += 5;
      const positions = config.positions || [];
      if (positions.length) {
        doc.autoTable({
          startY: y,
          margin: { left: margin, right: margin },
          head: [["Posición", "Puntos"]],
          body: positions.map((p) => [`${p.place}°`, `${p.points} pts`]),
          styles: { fontSize: 9 },
          headStyles: { fillColor: [34, 197, 94] },
        });
        y = doc.lastAutoTable.finalY + 6;
      }
      if (config.unit) { doc.text(`Unidad de medida: ${config.unit === "seconds" ? "segundos" : config.unit}`, margin, y); y += 5; }

    } else if (comp.competition_type === "performance") {
      doc.text("Se marcan los criterios/eventos logrados por cada equipo. Los puntos se suman.", margin, y);
      y += 5;
      const events = config.events || [];
      if (events.length) {
        doc.autoTable({
          startY: y,
          margin: { left: margin, right: margin },
          head: [["Criterio / Evento", "Puntos si se logra"]],
          body: events.map((e) => [e.label, `${e.points} pts`]),
          styles: { fontSize: 9 },
          headStyles: { fillColor: [34, 197, 94] },
        });
        y = doc.lastAutoTable.finalY + 6;
      }
      doc.text("El juez marca con ✓ cada criterio logrado por ronda. Los puntos se acumulan entre rondas.", margin, y);
      y += 5;

    } else if (comp.competition_type === "combat") {
      doc.text("Se registran combates entre pares de equipos.", margin, y);
      y += 5;
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [["Resultado", "Puntos"]],
        body: [
          ["Victoria", `${config.win_points ?? 3} pts`],
          ["Empate", `${config.draw_points ?? 1} pts`],
          ["Derrota", `${config.loss_points ?? 0} pts`],
        ],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [34, 197, 94] },
      });
      y = doc.lastAutoTable.finalY + 6;

    } else if (comp.competition_type === "elimination") {
      doc.text("Rondas eliminatorias progresivas. Equipos acumulan puntos por ronda superada.", margin, y);
      y += 5;
      doc.text(`Puntos por ronda superada: ${config.points_per_round_survived ?? 2} pts`, margin, y);
      y += 5;

    } else if (comp.competition_type === "timed_quantity") {
      doc.text(`Se mide el tiempo para mover ${config.quantity || "N"} objetos. Menor tiempo = mejor posición.`, margin, y);
      y += 5;
      const pts = config.points_by_position || [];
      if (pts.length) {
        doc.autoTable({
          startY: y,
          margin: { left: margin, right: margin },
          head: [["Posición", "Puntos"]],
          body: pts.map((p, i) => [`${i + 1}°`, `${p} pts`]),
          styles: { fontSize: 9 },
          headStyles: { fillColor: [34, 197, 94] },
        });
        y = doc.lastAutoTable.finalY + 6;
      }
    }

    // ── Jueces asignados ──
    if (y > 230) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("JUECES DE CAMPO ASIGNADOS", margin, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);

    if (judges.length) {
      judges.forEach((j, i) => {
        const name = j.evaluator?.profile?.display_name || `Juez ${i + 1}`;
        doc.text(`${i + 1}. ${name}`, margin + 4, y);
        y += 5;
      });
    } else {
      doc.text("Sin jueces asignados aún.", margin + 4, y);
      y += 5;
    }

    // ── Orden de equipos ──
    y += 6;
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("EQUIPOS PARTICIPANTES (Orden de presentación)", margin, y);
    y += 6;

    if (teams.length) {
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [["#", "Equipo", "Grado"]],
        body: teams.map((t, i) => [i + 1, t.name, t.grade_label || "—"]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [34, 197, 94] },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // ── Instrucciones para el juez ──
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("INSTRUCCIONES PARA EL JUEZ", margin, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);

    const instructions = [
      "1. Ingrese a la plataforma con su correo y contraseña asignados.",
      "2. En el Panel jurado, busque la sección '🏁 Pruebas de campo' y seleccione esta competencia.",
      "3. Cree rondas con el botón '+ Nueva ronda' según avance la competencia.",
      "4. Registre los resultados de cada equipo en la ronda activa.",
      "5. Los cálculos de ranking se actualizan automáticamente en tiempo real.",
      "6. Puede subir fotos de los equipos desde la sección inferior de la pantalla.",
      "7. Si tiene dudas, consulte al administrador.",
    ];
    instructions.forEach((line) => { doc.text(line, margin, y); y += 4.5; });

    // ── Pie de página ──
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Feria STEAM ${new Date().getFullYear()} – Documento generado automáticamente`, pageW / 2, 287, { align: "center" });
      doc.text(`Página ${i} de ${totalPages}`, pageW - margin, 287, { align: "right" });
      doc.setTextColor(0);
    }

    doc.save(`Juez-Campo-${projName.replace(/\s+/g, "-")}.pdf`);
    toast("PDF generado", "success");
  } catch (err) {
    toast("Error: " + (err?.message || err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📄 PDF Jueces";
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
