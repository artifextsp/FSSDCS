import { el, clear, toast, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import { listProjects, listEvaluators } from "../data.js?v=19";
import { analyticsGetEditionEvaluations, analyticsGetAnswersForEvaluations } from "../data.js?v=19";

/* ================================================================
   Módulo de Analítica – Feria STEAM
   Requiere rol admin. Se monta como sección del panel de admin.
   ================================================================ */

// ─── Paleta de colores para gráficas ────────────────────────────
const PALETTE = [
  "#5b8def", "#6ddc9b", "#f0b65a", "#ef5d6f",
  "#a78bfa", "#fb923c", "#f472b6", "#22d3ee",
  "#34d399", "#fbbf24", "#818cf8", "#f87171",
];

// ─── Carga diferida de librerías CDN ────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar: " + src));
    document.head.append(s);
  });
}

async function loadChartJS() {
  if (window.Chart) return window.Chart;
  await loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js");
  return window.Chart;
}

async function loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf;
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js");
  return window.jspdf;
}

// ─── Render principal (punto de entrada desde admin.js) ─────────

export async function renderAnalyticsAdmin(body, edition) {
  clear(body);

  if (!edition) {
    body.append(el("div", { class: "empty mt-6", text: "Selecciona una edición para ver la analítica." }));
    return;
  }

  // Estado de carga
  const loadingEl = el("div", { class: "loading-screen" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", { text: "Cargando datos de evaluaciones…" }),
  ]);
  body.append(loadingEl);

  let projects, evaluators, evaluations, answers;
  try {
    [projects, evaluators, evaluations] = await Promise.all([
      listProjects(edition.id),
      listEvaluators(edition.id),
      analyticsGetEditionEvaluations(edition.id),
    ]);
    answers = await analyticsGetAnswersForEvaluations(evaluations.map((e) => e.id));
  } catch (err) {
    clear(body);
    body.append(el("div", { class: "error-banner", text: "Error al cargar datos: " + (err?.message || err) }));
    return;
  }

  clear(body);

  // ── Construir mapas de lookup ──────────────────────────────────
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));

  const evaluatorMap = {};
  evaluators.forEach((ev) => {
    evaluatorMap[ev.id] = ev.profile?.display_name || `Jurado ${ev.id.slice(0, 6)}`;
  });

  // teamMap: extraído de las evaluaciones
  const teamMap = {};
  evaluations.forEach((ev) => {
    if (ev.team && !teamMap[ev.team_id]) {
      teamMap[ev.team_id] = { id: ev.team_id, name: ev.team.name, projectId: ev.project_id };
    }
  });

  // answersByEval
  const answersByEval = {};
  answers.forEach((a) => {
    if (!answersByEval[a.evaluation_id]) answersByEval[a.evaluation_id] = [];
    answersByEval[a.evaluation_id].push(a);
  });

  // ── Estadísticas globales ──────────────────────────────────────
  const uniqueTeams = new Set(evaluations.map((e) => e.team_id)).size;
  const allScores = evaluations.filter((e) => e.total_score != null).map((e) => Number(e.total_score));
  const overallAvg = allScores.length
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : null;

  // ── Tarjetas resumen ──────────────────────────────────────────
  body.append(
    el("div", {
      class: "grid mt-4",
      style: { gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: "var(--space-4)" },
    }, [
      metricCard("Proyectos", projects.length),
      metricCard("Equipos calificados", uniqueTeams),
      metricCard("Evaluaciones enviadas", evaluations.length),
      metricCard("Jurados", evaluators.length),
      metricCard("Promedio general", fmtScore(overallAvg)),
    ])
  );

  // ── Pestañas internas ─────────────────────────────────────────
  const innerTabs = el("div", { class: "tabs mt-6" });
  const innerBody = el("div", { class: "mt-5" });
  body.append(innerTabs, innerBody);

  const ctx = { projects, projectMap, evaluatorMap, teamMap, evaluations, answersByEval, evaluators };
  const tabDefs = [
    ["proyectos", "Proyectos"],
    ["jurados", "Jurados"],
    ["equipos", "Detalle equipos"],
  ];

  let activeKey = "proyectos";

  function switchTab(key) {
    activeKey = key;
    tabDefs.forEach(([k]) => {
      innerTabs.querySelector(`[data-inner="${k}"]`)?.classList.toggle("is-active", k === key);
    });
    renderTabContent(innerBody, key, ctx);
  }

  tabDefs.forEach(([k, l]) => {
    const btn = el("button", {
      class: `tabs__btn ${k === activeKey ? "is-active" : ""}`,
      "data-inner": k,
      text: l,
      onclick: () => switchTab(k),
    });
    innerTabs.append(btn);
  });

  renderTabContent(innerBody, activeKey, ctx);
}

// ─── Dispatch de pestañas internas ───────────────────────────────

function renderTabContent(container, key, ctx) {
  clear(container);
  if (key === "proyectos") renderByProject(container, ctx);
  else if (key === "jurados") renderByJury(container, ctx);
  else if (key === "equipos") renderByTeams(container, ctx);
}

// ══════════════════════════════════════════════════════════════
//  TAB 1: Por proyecto
// ══════════════════════════════════════════════════════════════

function renderByProject(container, { projects, evaluatorMap, teamMap, evaluations, answersByEval }) {
  if (!projects.length) {
    container.append(el("div", { class: "empty", text: "No hay proyectos en esta edición." }));
    return;
  }
  if (!evaluations.length) {
    container.append(el("div", { class: "empty", text: "Aún no hay evaluaciones enviadas." }));
    return;
  }

  // ── Gráfica comparativa de promedios por proyecto ─────────────
  const projectAvgs = projects
    .map((proj) => {
      const evals = evaluations.filter((e) => e.project_id === proj.id && e.total_score != null);
      const avg = evals.length ? evals.reduce((s, e) => s + Number(e.total_score), 0) / evals.length : null;
      return { project: proj, avg, count: evals.length };
    })
    .filter((x) => x.avg != null);

  if (projectAvgs.length > 0) {
    const canvasComp = el("canvas", {});
    container.append(
      el("div", { class: "card mb-6" }, [
        el("h3", { class: "card__title", text: "Comparativo de promedios por proyecto" }),
        el("p", { class: "text-muted", style: { fontSize: "0.85rem", marginBottom: "var(--space-4)" },
          text: "Promedio de todas las evaluaciones enviadas por proyecto." }),
        el("div", { style: { position: "relative", height: "260px" } }, [canvasComp]),
      ])
    );
    setTimeout(async () => {
      try {
        const Chart = await loadChartJS();
        new Chart(canvasComp, {
          type: "bar",
          data: {
            labels: projectAvgs.map((x) => x.project.name),
            datasets: [{
              label: "Promedio",
              data: projectAvgs.map((x) => +x.avg.toFixed(2)),
              backgroundColor: projectAvgs.map((_, i) => PALETTE[i % PALETTE.length] + "cc"),
              borderColor: projectAvgs.map((_, i) => PALETTE[i % PALETTE.length]),
              borderWidth: 2,
              borderRadius: 8,
            }],
          },
          options: chartBaseOptions({ showLegend: false }),
        });
      } catch (e) { console.warn("[analytics] comp chart failed", e); }
    }, 0);
  }

  // ── Tarjeta por proyecto ──────────────────────────────────────
  for (const proj of projects) {
    const projEvals = evaluations.filter((e) => e.project_id === proj.id);
    if (!projEvals.length) continue;

    const projTeamIds = [...new Set(projEvals.map((e) => e.team_id))];
    const projTeams = projTeamIds
      .map((id) => teamMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    const projEvaluatorIds = [...new Set(projEvals.map((e) => e.evaluator_id))];

    const projScores = projEvals.filter((e) => e.total_score != null).map((e) => Number(e.total_score));
    const projAvg = projScores.length
      ? projScores.reduce((a, b) => a + b, 0) / projScores.length
      : null;

    // Promedio y resumen por jurado
    const jurorRows = projEvaluatorIds.map((evId) => {
      const evEvals = projEvals.filter((e) => e.evaluator_id === evId && e.total_score != null);
      const avg = evEvals.length
        ? evEvals.reduce((s, e) => s + Number(e.total_score), 0) / evEvals.length
        : null;
      return { evId, name: evaluatorMap[evId] || "Jurado", count: evEvals.length, avg };
    }).sort((a, b) => a.name.localeCompare(b.name, "es"));

    // Encabezado de la tarjeta
    const card = el("div", { class: "card mb-6" });
    card.append(
      el("div", {
        class: "flex items-center",
        style: { justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-4)" },
      }, [
        el("div", {}, [
          el("h3", { class: "card__title", style: { margin: 0 }, text: proj.name }),
          el("p", { class: "text-muted", style: { margin: "4px 0 0", fontSize: "0.88rem" } }, [
            "Promedio: ",
            el("strong", { text: fmtScore(projAvg) }),
            `  ·  ${projTeams.length} equipo${projTeams.length !== 1 ? "s" : ""}`,
            `  ·  ${projEvaluatorIds.length} jurado${projEvaluatorIds.length !== 1 ? "s" : ""}`,
          ]),
        ]),
        el("button", {
          class: "btn btn--primary btn--sm",
          text: "⬇ Descargar PDF",
          onclick: (e) => generateProjectPDF({
            btn: e.currentTarget,
            proj, projTeams, projEvals, jurorRows, teamMap, evaluatorMap, answersByEval,
          }),
        }),
      ])
    );

    // Tabla de jurados
    card.append(
      el("div", { class: "mb-4" }, [
        el("p", { style: { fontSize: "0.78rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--space-2)" }, text: "Jurados que calificaron" }),
        buildTable(
          ["Jurado", "Equipos calificados", "Valor asignado (promedio)"],
          jurorRows.map((r) => [r.name, r.count, fmtScore(r.avg)])
        ),
      ])
    );

    // Gráfica de líneas: calificaciones por equipo × jurado
    if (projTeams.length && projEvaluatorIds.length) {
      const canvasLine = el("canvas", {});
      card.append(
        el("div", { style: { position: "relative", height: "260px", marginTop: "var(--space-5)" } }, [canvasLine])
      );

      const teams = projTeams;
      const evIds = projEvaluatorIds;
      const evals = projEvals;
      const evMap = evaluatorMap;

      setTimeout(async () => {
        try {
          const Chart = await loadChartJS();
          const datasets = evIds.map((evId, i) => ({
            label: evMap[evId] || "Jurado",
            data: teams.map((team) => {
              const found = evals.find(
                (e) => e.evaluator_id === evId && e.team_id === team.id && e.total_score != null
              );
              return found ? +Number(found.total_score).toFixed(2) : null;
            }),
            borderColor: PALETTE[i % PALETTE.length],
            backgroundColor: PALETTE[i % PALETTE.length] + "22",
            tension: 0.35,
            pointRadius: 5,
            pointHoverRadius: 8,
            spanGaps: true,
          }));
          new Chart(canvasLine, {
            type: "line",
            data: { labels: teams.map((t) => t.name), datasets },
            options: {
              ...chartBaseOptions({ showLegend: true }),
              plugins: {
                ...chartBaseOptions({ showLegend: true }).plugins,
                title: {
                  display: true,
                  text: "Calificaciones por equipo (línea por jurado)",
                  color: "#a4afc8",
                  font: { size: 12 },
                  padding: { bottom: 10 },
                },
              },
            },
          });
        } catch (e) { console.warn("[analytics] line chart failed", e); }
      }, 0);
    }

    container.append(card);
  }
}

// ══════════════════════════════════════════════════════════════
//  TAB 2: Por jurado
// ══════════════════════════════════════════════════════════════

function renderByJury(container, { evaluators, evaluatorMap, evaluations, projectMap, teamMap }) {
  if (!evaluators.length) {
    container.append(el("div", { class: "empty", text: "No hay jurados en esta edición." }));
    return;
  }

  const jurorStats = evaluators.map((ev) => {
    const evEvals = evaluations.filter((e) => e.evaluator_id === ev.id && e.total_score != null);
    const avg = evEvals.length
      ? evEvals.reduce((s, e) => s + Number(e.total_score), 0) / evEvals.length
      : null;
    return {
      ev,
      name: evaluatorMap[ev.id] || "Jurado",
      projCount: new Set(evEvals.map((e) => e.project_id)).size,
      teamCount: new Set(evEvals.map((e) => e.team_id)).size,
      avg,
      evEvals,
    };
  });

  // Gráfica de barras: promedio por jurado
  const withData = jurorStats.filter((j) => j.avg != null);
  if (withData.length > 1) {
    const canvasJury = el("canvas", {});
    container.append(
      el("div", { class: "card mb-5" }, [
        el("h3", { class: "card__title", text: "Promedio de calificaciones por jurado" }),
        el("div", { style: { position: "relative", height: "240px" } }, [canvasJury]),
      ])
    );
    setTimeout(async () => {
      try {
        const Chart = await loadChartJS();
        new Chart(canvasJury, {
          type: "bar",
          data: {
            labels: withData.map((j) => j.name),
            datasets: [{
              label: "Promedio",
              data: withData.map((j) => +j.avg.toFixed(2)),
              backgroundColor: withData.map((_, i) => PALETTE[i % PALETTE.length] + "cc"),
              borderColor: withData.map((_, i) => PALETTE[i % PALETTE.length]),
              borderWidth: 2,
              borderRadius: 8,
            }],
          },
          options: chartBaseOptions({ showLegend: false }),
        });
      } catch (e) { console.warn("[analytics] jury chart failed", e); }
    }, 0);
  }

  // Tabla resumen de jurados
  container.append(
    el("div", { class: "card mb-6" }, [
      el("h3", { class: "card__title", text: "Resumen por jurado" }),
      buildTable(
        ["Jurado", "Proyectos", "Equipos calificados", "Promedio general"],
        jurorStats.map((j) => [j.name, j.projCount, j.teamCount, fmtScore(j.avg)])
      ),
    ])
  );

  // Detalle expandido por jurado
  jurorStats.forEach(({ name, evEvals }) => {
    if (!evEvals.length) return;

    const byProject = {};
    evEvals.forEach((e) => {
      if (!byProject[e.project_id]) byProject[e.project_id] = [];
      byProject[e.project_id].push(e);
    });

    const card = el("div", { class: "card mb-4" }, [
      el("h3", { class: "card__title", text: name }),
    ]);

    Object.entries(byProject).forEach(([projId, pEvals]) => {
      const proj = projectMap[projId];
      const projAvg = pEvals.filter((e) => e.total_score != null)
        .reduce((s, e, _, arr) => s + Number(e.total_score) / arr.length, 0);

      card.append(
        el("div", { class: "mt-4", style: { borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)" } }, [
          el("p", { style: { fontWeight: 600, fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "var(--space-2)" }, text: proj?.name || "Proyecto" }),
          buildTable(
            ["Equipo", "Puntaje asignado"],
            pEvals
              .sort((a, b) =>
                (teamMap[a.team_id]?.name || "").localeCompare(teamMap[b.team_id]?.name || "", "es")
              )
              .map((e) => [teamMap[e.team_id]?.name || "—", fmtScore(e.total_score)])
          ),
          el("p", { style: { fontSize: "0.82rem", textAlign: "right", marginTop: "4px", color: "var(--color-text-muted)" } }, [
            "Promedio en este proyecto: ",
            el("strong", { text: fmtScore(projAvg) }),
          ]),
        ])
      );
    });

    container.append(card);
  });
}

// ══════════════════════════════════════════════════════════════
//  TAB 3: Detalle equipos
// ══════════════════════════════════════════════════════════════

function renderByTeams(container, { projects, teamMap, evaluations, evaluatorMap, answersByEval }) {
  if (!evaluations.length) {
    container.append(el("div", { class: "empty", text: "Aún no hay evaluaciones enviadas." }));
    return;
  }

  for (const proj of projects) {
    const projEvals = evaluations.filter((e) => e.project_id === proj.id);
    if (!projEvals.length) continue;

    const projTeamIds = [...new Set(projEvals.map((e) => e.team_id))];
    const projTeams = projTeamIds
      .map((id) => teamMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    const projectCard = el("div", { class: "card mb-6" }, [
      el("h3", { class: "card__title", text: proj.name }),
    ]);

    for (const team of projTeams) {
      const teamEvals = projEvals.filter((e) => e.team_id === team.id);
      const scored = teamEvals.filter((e) => e.total_score != null);
      const teamAvg = scored.length
        ? scored.reduce((s, e) => s + Number(e.total_score), 0) / scored.length
        : null;

      const teamSection = el("div", {
        style: { borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)", marginTop: "var(--space-4)" },
      }, [
        el("div", {
          class: "flex items-center",
          style: { justifyContent: "space-between", marginBottom: "var(--space-3)", flexWrap: "wrap", gap: "8px" },
        }, [
          el("p", { style: { fontWeight: 700, margin: 0, fontSize: "1rem" }, text: team.name }),
          el("span", {
            style: {
              background: "var(--color-primary-soft)", color: "var(--color-primary)",
              borderRadius: "var(--radius-pill)", padding: "3px 12px", fontSize: "0.85rem", fontWeight: 600,
            },
            text: `Promedio: ${fmtScore(teamAvg)}`,
          }),
        ]),
      ]);

      // Jurado por jurado
      teamEvals
        .sort((a, b) =>
          (evaluatorMap[a.evaluator_id] || "").localeCompare(evaluatorMap[b.evaluator_id] || "", "es")
        )
        .forEach((ev) => {
          const jurorName = evaluatorMap[ev.evaluator_id] || "Jurado";
          const answers = answersByEval[ev.id] || [];
          const observations = answers.filter((a) => a.observation?.trim());

          const evalCard = el("div", {
            class: "card",
            style: { background: "var(--color-surface-2)", marginBottom: "var(--space-3)" },
          }, [
            el("div", {
              class: "flex items-center",
              style: { justifyContent: "space-between", flexWrap: "wrap", gap: "8px" },
            }, [
              el("span", { style: { fontWeight: 600, fontSize: "0.95rem" }, text: jurorName }),
              el("span", {
                style: { color: "var(--color-accent)", fontWeight: 700, fontSize: "1.1rem" },
                text: fmtScore(ev.total_score),
              }),
            ]),
          ]);

          if (observations.length) {
            const obsWrap = el("div", { class: "mt-3" });
            observations.forEach((obs) => {
              obsWrap.append(
                el("div", {
                  style: {
                    background: "var(--color-surface-3)", borderRadius: "var(--radius-sm)",
                    padding: "var(--space-3) var(--space-4)", marginTop: "var(--space-2)",
                  },
                }, [
                  obs.item_key
                    ? el("p", {
                        style: { fontSize: "0.76rem", margin: "0 0 4px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" },
                        text: obs.item_key,
                      })
                    : null,
                  el("p", { style: { margin: 0, fontSize: "0.9rem", lineHeight: 1.6 }, text: obs.observation }),
                ])
              );
            });
            evalCard.append(obsWrap);
          } else {
            evalCard.append(
              el("p", {
                class: "text-muted",
                style: { fontSize: "0.83rem", margin: "8px 0 0", fontStyle: "italic" },
                text: "Sin observaciones escritas.",
              })
            );
          }

          teamSection.append(evalCard);
        });

      projectCard.append(teamSection);
    }

    container.append(projectCard);
  }
}

// ══════════════════════════════════════════════════════════════
//  Generación de PDF por proyecto
// ══════════════════════════════════════════════════════════════

async function generateProjectPDF({ btn, proj, projTeams, projEvals, jurorRows, teamMap, evaluatorMap, answersByEval }) {
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }

  try {
    const jspdfLib = await loadJsPDF();
    const { jsPDF } = jspdfLib;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 22;

    // Colores corporativos
    const C = { heading: [30, 50, 100], sub: [60, 80, 130], muted: [110, 120, 150] };

    // ── Encabezado ────────────────────────────────────────────
    doc.setFillColor(20, 35, 80);
    doc.rect(0, 0, pageW, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(200, 210, 240);
    doc.text("FERIA STEAM · Seminario Diocesano Cristo Sacerdote", margin, 9);

    y = 22;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...C.heading);
    doc.text("Informe de Evaluaciones", margin, y);
    y += 7;

    doc.setFontSize(12);
    doc.setTextColor(...C.sub);
    doc.text(proj.name, margin, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    const dateStr = new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeStyle: "short" }).format(new Date());
    doc.text(`Generado: ${dateStr}`, margin, y);
    y += 8;

    doc.setDrawColor(180, 195, 230);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    // ── Resumen global ───────────────────────────────────────
    const projScores = projEvals.filter((e) => e.total_score != null).map((e) => Number(e.total_score));
    const projAvg = projScores.length
      ? projScores.reduce((a, b) => a + b, 0) / projScores.length
      : null;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.heading);
    doc.text("Resumen del proyecto", margin, y);
    y += 3;

    doc.autoTable({
      startY: y,
      head: [["Indicador", "Valor"]],
      body: [
        ["Promedio general", fmtScore(projAvg)],
        ["Equipos calificados", projTeams.length],
        ["Jurados evaluadores", jurorRows.length],
        ["Total evaluaciones", projEvals.length],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 50, 120], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 244, 255] },
      margin: { left: margin, right: margin },
      theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 10;

    // ── Tabla de jurados ──────────────────────────────────────
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.heading);
    doc.text("Calificaciones por jurado", margin, y);
    y += 3;

    doc.autoTable({
      startY: y,
      head: [["Jurado", "Equipos calificados", "Valor asignado (promedio)"]],
      body: jurorRows.map((r) => [r.name, r.count, fmtScore(r.avg)]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 50, 120], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 244, 255] },
      columnStyles: { 1: { halign: "center" }, 2: { halign: "center" } },
      margin: { left: margin, right: margin },
      theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 12;

    // ── Detalle por equipo ────────────────────────────────────
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.heading);
    if (y > 250) { doc.addPage(); y = 20; }
    doc.text("Detalle por equipo", margin, y);
    y += 6;

    for (const team of projTeams) {
      const teamEvals = projEvals.filter((e) => e.team_id === team.id && e.total_score != null);
      if (!teamEvals.length) continue;

      const teamAvg = teamEvals.reduce((s, e) => s + Number(e.total_score), 0) / teamEvals.length;

      if (y > 245) { doc.addPage(); y = 20; }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...C.sub);
      doc.text(`${team.name}`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text(`Promedio: ${fmtScore(teamAvg)}`, margin + 80, y);
      y += 3;

      const tableBody = teamEvals
        .sort((a, b) =>
          (evaluatorMap[a.evaluator_id] || "").localeCompare(evaluatorMap[b.evaluator_id] || "", "es")
        )
        .map((ev) => {
          const answers = answersByEval[ev.id] || [];
          const obs = answers
            .filter((a) => a.observation?.trim())
            .map((a) => (a.item_key ? `[${a.item_key}] ${a.observation.trim()}` : a.observation.trim()))
            .join("\n\n");
          return [evaluatorMap[ev.evaluator_id] || "—", fmtScore(ev.total_score), obs || "Sin observaciones"];
        });

      doc.autoTable({
        startY: y,
        head: [["Jurado", "Puntaje", "Observaciones / Feedback"]],
        body: tableBody,
        styles: { fontSize: 8, cellPadding: 3, valign: "top", overflow: "linebreak" },
        headStyles: { fillColor: [60, 90, 170], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 18, halign: "center", fontStyle: "bold" },
          2: { cellWidth: "auto" },
        },
        margin: { left: margin, right: margin },
        theme: "striped",
        didDrawPage: () => { },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Pie de página ─────────────────────────────────────────
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(20, 35, 80);
      doc.rect(0, 285, pageW, 12, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(180, 195, 230);
      doc.text(
        `Feria STEAM · Informe confidencial · Pág ${i} / ${pageCount}`,
        pageW / 2,
        292,
        { align: "center" }
      );
    }

    const safeName = proj.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/, "");
    doc.save(`informe-${safeName}.pdf`);
    toast("PDF descargado correctamente", "success");
  } catch (err) {
    console.error("[analytics] PDF error", err);
    toast("Error al generar el PDF: " + (err?.message || err), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇ Descargar PDF"; }
  }
}

// ══════════════════════════════════════════════════════════════
//  Utilidades de UI
// ══════════════════════════════════════════════════════════════

function metricCard(label, value) {
  return el("div", { class: "card metric" }, [
    el("div", { class: "metric__label", text: String(label) }),
    el("div", { class: "metric__value", text: String(value) }),
  ]);
}

function buildTable(headers, rows) {
  const th = (text) =>
    el("th", {
      text,
      style: {
        textAlign: "left", padding: "var(--space-2) var(--space-3)",
        fontSize: "0.77rem", color: "var(--color-text-muted)", fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
      },
    });
  const td = (text) =>
    el("td", {
      text: String(text ?? "—"),
      style: {
        padding: "var(--space-2) var(--space-3)", fontSize: "0.9rem",
        borderBottom: "1px solid var(--color-border)",
      },
    });

  const thead = el("thead", {}, [el("tr", {}, headers.map(th))]);
  const tbody = el("tbody", {});
  rows.forEach((row) => tbody.append(el("tr", {}, row.map(td))));

  return el("table", { style: { width: "100%", borderCollapse: "collapse" } }, [thead, tbody]);
}

function chartBaseOptions({ showLegend = true } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: showLegend,
        labels: { color: "#a4afc8", usePointStyle: true, pointStyleWidth: 10 },
      },
      tooltip: {
        callbacks: { label: (c) => ` ${c.dataset.label ?? ""}: ${c.parsed.y?.toFixed ? c.parsed.y.toFixed(2) : c.parsed.y}` },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        grid: { color: "rgba(255,255,255,0.06)" },
        ticks: { color: "#a4afc8" },
      },
      x: {
        grid: { color: "rgba(255,255,255,0.04)" },
        ticks: { color: "#a4afc8", maxRotation: 30 },
      },
    },
  };
}
