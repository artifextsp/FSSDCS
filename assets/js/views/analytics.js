import { el, clear, toast, fmtScore } from "../utils.js?v=19";
import { listProjects, listEvaluators } from "../data.js?v=19";
import {
  analyticsGetEditionEvaluations,
  analyticsGetAnswersForEvaluations,
  analyticsGetTeamMembers,
} from "../data.js?v=19";

/* ================================================================
   Módulo de Analítica – Feria STEAM
   Requiere rol admin. Se monta como sección del panel de admin.
   ================================================================ */

// ─── Paleta de colores ───────────────────────────────────────────
const PALETTE = [
  "#5b8def", "#6ddc9b", "#f0b65a", "#ef5d6f",
  "#a78bfa", "#fb923c", "#f472b6", "#22d3ee",
  "#34d399", "#fbbf24", "#818cf8", "#f87171",
];

// ─── Escala de equivalencia académica ────────────────────────────
const SCALE_KEY = "feria-steam-grade-scale";
const DEFAULT_SCALE = [
  { min: 0,   max: 2.0, label: "Bajo",     equivalent: 2.0 },
  { min: 2.1, max: 3.0, label: "Básico",   equivalent: 3.0 },
  { min: 3.1, max: 3.9, label: "Alto",     equivalent: 3.9 },
  { min: 4.0, max: 4.5, label: "Alto",     equivalent: 4.5 },
  { min: 4.6, max: 5.0, label: "Superior", equivalent: 5.0 },
];

function loadScale() {
  try {
    const raw = localStorage.getItem(SCALE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return DEFAULT_SCALE.map((s) => ({ ...s }));
}

function saveScale(scale) {
  localStorage.setItem(SCALE_KEY, JSON.stringify(scale));
}

function getEquivalent(score, scale) {
  if (score == null) return { label: "—", equivalent: null };
  const n = Number(score);
  for (const band of scale) {
    if (n >= band.min && n <= band.max) return { label: band.label, equivalent: band.equivalent };
  }
  return { label: "—", equivalent: null };
}

/**
 * Extrae "primer nombre + primer apellido" para el CSV de Ludens.
 * Heurística: para nombres con ≥3 partes → parte[0] + parte[ceil/2].
 */
function ludensName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");
  if (parts.length === 3) return `${parts[0]} ${parts[2]}`; // N A1 A2 → N A1; N1 N2 A → N A
  return `${parts[0]} ${parts[2]}`; // N1 N2 A1 A2 → N1 A1
}

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

// ─── Render principal ────────────────────────────────────────────
export async function renderAnalyticsAdmin(body, edition) {
  clear(body);
  if (!edition) {
    body.append(el("div", { class: "empty mt-6", text: "Selecciona una edición para ver la analítica." }));
    return;
  }

  const loadingEl = el("div", { class: "loading-screen" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", { text: "Cargando datos de evaluaciones…" }),
  ]);
  body.append(loadingEl);

  let projects, evaluators, evaluations, answers, members;
  try {
    [projects, evaluators, evaluations] = await Promise.all([
      listProjects(edition.id),
      listEvaluators(edition.id),
      analyticsGetEditionEvaluations(edition.id),
    ]);
    const teamIds = [...new Set(evaluations.map((e) => e.team_id))];
    [answers, members] = await Promise.all([
      analyticsGetAnswersForEvaluations(evaluations.map((e) => e.id)),
      analyticsGetTeamMembers(teamIds),
    ]);
  } catch (err) {
    clear(body);
    body.append(el("div", { class: "error-banner", text: "Error al cargar datos: " + (err?.message || err) }));
    return;
  }
  clear(body);

  // ── Mapas de lookup ───────────────────────────────────────────
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));

  const evaluatorMap = {};
  evaluators.forEach((ev) => {
    evaluatorMap[ev.id] = ev.profile?.display_name || `Jurado ${ev.id.slice(0, 6)}`;
  });

  const teamMap = {};
  evaluations.forEach((ev) => {
    if (ev.team && !teamMap[ev.team_id]) {
      teamMap[ev.team_id] = {
        id: ev.team_id,
        name: ev.team.name,
        projectId: ev.project_id,
        room: ev.team.room,
        gradeLabel: ev.team.grade_label,
        presentationOrder: ev.team.presentation_order,
      };
    }
  });

  const answersByEval = {};
  answers.forEach((a) => {
    if (!answersByEval[a.evaluation_id]) answersByEval[a.evaluation_id] = [];
    answersByEval[a.evaluation_id].push(a);
  });

  const membersByTeam = {};
  members.forEach((m) => {
    if (!membersByTeam[m.team_id]) membersByTeam[m.team_id] = [];
    membersByTeam[m.team_id].push(m);
  });

  // ── Estadísticas globales ─────────────────────────────────────
  const uniqueTeams = new Set(evaluations.map((e) => e.team_id)).size;
  const allScores = evaluations.filter((e) => e.total_score != null).map((e) => Number(e.total_score));
  const overallAvg = allScores.length
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : null;

  const scale = loadScale();

  // ── Tarjetas de resumen ───────────────────────────────────────
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

  const ctx = {
    edition, projects, projectMap, evaluatorMap, teamMap,
    evaluations, answersByEval, evaluators, membersByTeam, scale,
  };

  const tabDefs = [
    ["proyectos", "Proyectos"],
    ["jurados",   "Jurados"],
    ["equipos",   "Detalle equipos"],
    ["informes",  "Informes PDF / CSV"],
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

// ─── Dispatch de pestañas ────────────────────────────────────────
function renderTabContent(container, key, ctx) {
  clear(container);
  if (key === "proyectos") renderByProject(container, ctx);
  else if (key === "jurados") renderByJury(container, ctx);
  else if (key === "equipos") renderByTeams(container, ctx);
  else if (key === "informes") renderReports(container, ctx);
}

// ══════════════════════════════════════════════════════════════
//  TAB 1: Por proyecto
// ══════════════════════════════════════════════════════════════
function renderByProject(container, { projects, evaluatorMap, teamMap, evaluations, answersByEval, membersByTeam, scale }) {
  if (!evaluations.length) {
    container.append(el("div", { class: "empty", text: "Aún no hay evaluaciones enviadas." }));
    return;
  }

  // Promedios por proyecto, ordenados de mayor a menor
  const projectAvgs = projects
    .map((proj) => {
      const evals = evaluations.filter((e) => e.project_id === proj.id && e.total_score != null);
      const avg = evals.length ? evals.reduce((s, e) => s + Number(e.total_score), 0) / evals.length : null;
      return { project: proj, avg, count: evals.length };
    })
    .filter((x) => x.avg != null)
    .sort((a, b) => b.avg - a.avg);

  // ── Gráfica comparativa ───────────────────────────────────────
  if (projectAvgs.length > 0) {
    const canvasComp = el("canvas", {});
    container.append(
      el("div", { class: "card mb-6" }, [
        el("h3", { class: "card__title", text: "Comparativo de promedios por proyecto" }),
        el("p", { class: "text-muted", style: { fontSize: "0.85rem", marginBottom: "var(--space-4)" },
          text: "Ordenado de mayor a menor. Promedio de todas las evaluaciones enviadas." }),
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

  // ── Tarjeta por proyecto (ordenadas por avg desc) ─────────────
  for (const { project: proj } of projectAvgs) {
    const projEvals = evaluations.filter((e) => e.project_id === proj.id);

    const projTeamIds = [...new Set(projEvals.map((e) => e.team_id))];
    const projTeams = projTeamIds
      .map((id) => teamMap[id])
      .filter(Boolean);

    // Calcular avg por equipo para ordenar
    const teamsWithAvg = projTeams
      .map((team) => {
        const te = projEvals.filter((e) => e.team_id === team.id && e.total_score != null);
        const avg = te.length ? te.reduce((s, e) => s + Number(e.total_score), 0) / te.length : null;
        return { ...team, avg };
      })
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

    const projEvaluatorIds = [...new Set(projEvals.map((e) => e.evaluator_id))];

    const projScores = projEvals.filter((e) => e.total_score != null).map((e) => Number(e.total_score));
    const projAvg = projScores.length
      ? projScores.reduce((a, b) => a + b, 0) / projScores.length
      : null;

    // Jurados con al menos un puntaje > 0, ordenados por avg desc
    const jurorRows = projEvaluatorIds
      .map((evId) => {
        const evEvals = projEvals.filter((e) => e.evaluator_id === evId && e.total_score != null);
        const avg = evEvals.length
          ? evEvals.reduce((s, e) => s + Number(e.total_score), 0) / evEvals.length
          : null;
        return { evId, name: evaluatorMap[evId] || "Jurado", count: evEvals.length, avg };
      })
      .filter((r) => r.avg != null && r.avg > 0)
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

    const card = el("div", { class: "card mb-6" });

    card.append(
      el("div", {
        class: "flex items-center",
        style: { justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-4)" },
      }, [
        el("div", {}, [
          el("h3", { class: "card__title", style: { margin: 0 }, text: proj.name }),
          el("p", { class: "text-muted", style: { margin: "4px 0 0", fontSize: "0.88rem" } }, [
            "Promedio: ", el("strong", { text: fmtScore(projAvg) }),
            `  ·  ${teamsWithAvg.length} equipo${teamsWithAvg.length !== 1 ? "s" : ""}`,
            `  ·  ${jurorRows.length} jurado${jurorRows.length !== 1 ? "s" : ""}`,
          ]),
        ]),
        el("button", {
          class: "btn btn--primary btn--sm",
          text: "⬇ PDF del proyecto",
          onclick: (e) => generateProjectPDF({
            btn: e.currentTarget, proj,
            projTeams: teamsWithAvg, projEvals, jurorRows,
            teamMap, evaluatorMap, answersByEval, membersByTeam, scale,
          }),
        }),
      ])
    );

    // Tabla de jurados
    if (jurorRows.length) {
      card.append(
        el("div", { class: "mb-5" }, [
          sectionLabel("Jurados que calificaron"),
          buildTable(
            ["Jurado", "Equipos calificados", "Puntaje promedio asignado"],
            jurorRows.map((r) => [r.name, r.count, fmtScore(r.avg)])
          ),
        ])
      );
    }

    // Gráfica de COLUMNAS agrupadas: equipos × jurados
    if (teamsWithAvg.length && projEvaluatorIds.length) {
      const canvasBar = el("canvas", {});
      card.append(el("div", { style: { position: "relative", height: "280px", marginTop: "var(--space-5)" } }, [canvasBar]));

      const teams = teamsWithAvg;
      const evIds = projEvaluatorIds;
      const evals = projEvals;

      setTimeout(async () => {
        try {
          const Chart = await loadChartJS();
          const datasets = evIds.map((evId, i) => ({
            label: evaluatorMap[evId] || "Jurado",
            data: teams.map((team) => {
              const found = evals.find((e) => e.evaluator_id === evId && e.team_id === team.id && e.total_score != null);
              return found ? +Number(found.total_score).toFixed(2) : null;
            }),
            backgroundColor: PALETTE[i % PALETTE.length] + "cc",
            borderColor: PALETTE[i % PALETTE.length],
            borderWidth: 2,
            borderRadius: 5,
          }));
          new Chart(canvasBar, {
            type: "bar",
            data: { labels: teams.map((t) => t.name), datasets },
            options: {
              ...chartBaseOptions({ showLegend: true }),
              plugins: {
                ...chartBaseOptions({ showLegend: true }).plugins,
                title: {
                  display: true,
                  text: "Calificaciones por equipo y jurado",
                  color: "#a4afc8",
                  font: { size: 12 },
                  padding: { bottom: 10 },
                },
              },
              scales: {
                x: { stacked: false, grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#a4afc8", maxRotation: 30 } },
                y: { stacked: false, beginAtZero: true, grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#a4afc8" } },
              },
            },
          });
        } catch (e) { console.warn("[analytics] bar chart failed", e); }
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

  // Solo jurados con puntajes > 0, ordenados desc
  const jurorStats = evaluators
    .map((ev) => {
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
    })
    .filter((j) => j.avg != null && j.avg > 0)
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  if (!jurorStats.length) {
    container.append(el("div", { class: "empty", text: "Ningún jurado ha enviado calificaciones aún." }));
    return;
  }

  // ── Búsqueda ──────────────────────────────────────────────────
  let jurorFilter = "";
  const searchEl = searchInput("Buscar jurado…", (val) => {
    jurorFilter = val;
    renderJurorList();
  });
  container.append(searchEl);

  // ── Gráfica de barras ─────────────────────────────────────────
  const canvasJury = el("canvas", {});
  container.append(
    el("div", { class: "card mb-5 mt-4" }, [
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
          labels: jurorStats.map((j) => j.name),
          datasets: [{
            label: "Promedio",
            data: jurorStats.map((j) => +j.avg.toFixed(2)),
            backgroundColor: jurorStats.map((_, i) => PALETTE[i % PALETTE.length] + "cc"),
            borderColor: jurorStats.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 2, borderRadius: 8,
          }],
        },
        options: chartBaseOptions({ showLegend: false }),
      });
    } catch (e) { console.warn("[analytics] jury chart failed", e); }
  }, 0);

  // ── Tabla resumen ─────────────────────────────────────────────
  container.append(
    el("div", { class: "card mb-6" }, [
      el("h3", { class: "card__title", text: "Resumen por jurado" }),
      buildTable(
        ["#", "Jurado", "Proyectos", "Equipos calificados", "Promedio general"],
        jurorStats.map((j, i) => [`#${i + 1}`, j.name, j.projCount, j.teamCount, fmtScore(j.avg)])
      ),
    ])
  );

  // ── Lista filtrable por jurado ────────────────────────────────
  const listRoot = el("div");
  container.append(listRoot);

  function renderJurorList() {
    clear(listRoot);
    const filtered = jurorFilter
      ? jurorStats.filter((j) => j.name.toLowerCase().includes(jurorFilter.toLowerCase()))
      : jurorStats;

    filtered.forEach(({ name, evEvals }) => {
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

        // Equipos ordenados de mayor a menor puntaje
        const sorted = pEvals
          .filter((e) => e.total_score != null)
          .sort((a, b) => Number(b.total_score) - Number(a.total_score));

        card.append(
          el("div", { class: "mt-4", style: { borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)" } }, [
            el("p", { style: { fontWeight: 600, fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "var(--space-2)" }, text: proj?.name || "Proyecto" }),
            buildTable(
              ["#", "Equipo", "Puntaje asignado"],
              sorted.map((e, i) => [`#${i + 1}`, teamMap[e.team_id]?.name || "—", fmtScore(e.total_score)])
            ),
            el("p", { style: { fontSize: "0.82rem", textAlign: "right", marginTop: "4px", color: "var(--color-text-muted)" } }, [
              "Promedio en este proyecto: ", el("strong", { text: fmtScore(projAvg) }),
            ]),
          ])
        );
      });

      listRoot.append(card);
    });

    if (!filtered.length) {
      listRoot.append(el("div", { class: "empty", text: "Ningún jurado coincide con la búsqueda." }));
    }
  }

  renderJurorList();
}

// ══════════════════════════════════════════════════════════════
//  TAB 3: Detalle equipos
// ══════════════════════════════════════════════════════════════
function renderByTeams(container, { projects, teamMap, evaluations, evaluatorMap, answersByEval, membersByTeam, scale }) {
  if (!evaluations.length) {
    container.append(el("div", { class: "empty", text: "Aún no hay evaluaciones enviadas." }));
    return;
  }

  // ── Búsqueda ──────────────────────────────────────────────────
  let teamFilter = "";
  const searchEl = searchInput("Buscar equipo…", (val) => {
    teamFilter = val;
    renderTeamList();
  });
  container.append(searchEl);

  const listRoot = el("div", { class: "mt-4" });
  container.append(listRoot);

  function renderTeamList() {
    clear(listRoot);

    for (const proj of projects) {
      const projEvals = evaluations.filter((e) => e.project_id === proj.id);
      if (!projEvals.length) continue;

      // Equipos ordenados por avg desc
      const projTeamIds = [...new Set(projEvals.map((e) => e.team_id))];
      const projTeams = projTeamIds
        .map((id) => {
          const team = teamMap[id];
          if (!team) return null;
          const te = projEvals.filter((e) => e.team_id === id && e.total_score != null);
          const avg = te.length ? te.reduce((s, e) => s + Number(e.total_score), 0) / te.length : null;
          return { ...team, avg };
        })
        .filter(Boolean)
        .filter((t) => !teamFilter || t.name.toLowerCase().includes(teamFilter.toLowerCase()))
        .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

      if (!projTeams.length) continue;

      const projectCard = el("div", { class: "card mb-6" }, [
        el("h3", { class: "card__title", text: proj.name }),
      ]);

      projTeams.forEach((team, rank) => {
        const teamEvals = projEvals.filter((e) => e.team_id === team.id);
        const equiv = getEquivalent(team.avg, scale);
        const members = membersByTeam[team.id] || [];

        const teamSection = el("div", {
          style: { borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)", marginTop: "var(--space-4)" },
        });

        // Encabezado del equipo
        teamSection.append(
          el("div", {
            class: "flex items-center",
            style: { justifyContent: "space-between", marginBottom: "var(--space-3)", flexWrap: "wrap", gap: "8px" },
          }, [
            el("div", {}, [
              el("p", { style: { fontWeight: 700, margin: 0, fontSize: "1rem" } }, [
                el("span", { style: { color: "var(--color-text-muted)", marginRight: "6px", fontSize: "0.85rem" }, text: `#${rank + 1}` }),
                team.name,
              ]),
              members.length
                ? el("p", { class: "text-muted", style: { margin: "2px 0 0", fontSize: "0.82rem" } },
                    [members.map((m) => m.full_name).join(" · ")])
                : null,
            ]),
            el("div", { class: "flex gap-2", style: { flexWrap: "wrap" } }, [
              el("span", {
                style: {
                  background: "var(--color-primary-soft)", color: "var(--color-primary)",
                  borderRadius: "var(--radius-pill)", padding: "3px 12px", fontSize: "0.85rem", fontWeight: 600,
                },
                text: `Prom: ${fmtScore(team.avg)}`,
              }),
              equiv.label !== "—"
                ? el("span", {
                    style: {
                      background: "rgba(109,220,155,0.15)", color: "var(--color-accent)",
                      borderRadius: "var(--radius-pill)", padding: "3px 12px", fontSize: "0.85rem", fontWeight: 600,
                    },
                    text: `${equiv.label} (${fmtScore(equiv.equivalent)})`,
                  })
                : null,
              el("button", {
                class: "btn btn--ghost btn--sm",
                text: "⬇ PDF",
                onclick: (e) => generateTeamPDF({ btn: e.currentTarget, team, proj, teamEvals, evaluatorMap, answersByEval, membersByTeam, scale }),
              }),
              el("button", {
                class: "btn btn--ghost btn--sm",
                text: "⬇ CSV",
                onclick: (e) => generateTeamCSV({ btn: e.currentTarget, team, proj, teamEvals, membersByTeam, scale }),
              }),
            ]),
          ])
        );

        // Evaluaciones por jurado, ordenadas de mayor a menor
        teamEvals
          .filter((e) => e.total_score != null)
          .sort((a, b) => Number(b.total_score) - Number(a.total_score))
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
                el("span", { style: { color: "var(--color-accent)", fontWeight: 700, fontSize: "1.1rem" }, text: fmtScore(ev.total_score) }),
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
                      ? el("p", { style: { fontSize: "0.76rem", margin: "0 0 4px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }, text: obs.item_key })
                      : null,
                    el("p", { style: { margin: 0, fontSize: "0.9rem", lineHeight: 1.6 }, text: obs.observation }),
                  ])
                );
              });
              evalCard.append(obsWrap);
            } else {
              evalCard.append(
                el("p", { class: "text-muted", style: { fontSize: "0.83rem", margin: "8px 0 0", fontStyle: "italic" }, text: "Sin observaciones escritas." })
              );
            }

            teamSection.append(evalCard);
          });

        projectCard.append(teamSection);
      });

      listRoot.append(projectCard);
    }

    if (!listRoot.children.length) {
      listRoot.append(el("div", { class: "empty", text: "Ningún equipo coincide con la búsqueda." }));
    }
  }

  renderTeamList();
}

// ══════════════════════════════════════════════════════════════
//  TAB 4: Informes PDF / CSV
// ══════════════════════════════════════════════════════════════
function renderReports(container, ctx) {
  const { projects, projectMap, teamMap, evaluations, evaluatorMap, answersByEval, membersByTeam, scale } = ctx;

  // ── Configuración de escala ───────────────────────────────────
  let workingScale = scale.map((s) => ({ ...s }));

  const scaleBody = el("div");
  function renderScaleTable() {
    clear(scaleBody);
    const inputs = workingScale.map((band, i) => {
      const minEl = el("input", { class: "input", type: "number", step: "0.1", value: band.min, style: { width: "80px" } });
      const maxEl = el("input", { class: "input", type: "number", step: "0.1", value: band.max, style: { width: "80px" } });
      const lblEl = el("input", { class: "input", value: band.label, style: { width: "120px" } });
      const eqEl  = el("input", { class: "input", type: "number", step: "0.1", value: band.equivalent, style: { width: "80px" } });
      [minEl, maxEl, lblEl, eqEl].forEach((inp) => {
        inp.addEventListener("input", () => {
          workingScale[i] = {
            min: parseFloat(minEl.value) || 0,
            max: parseFloat(maxEl.value) || 0,
            label: lblEl.value,
            equivalent: parseFloat(eqEl.value) || 0,
          };
        });
      });
      return el("tr", {}, [
        el("td", { style: tdStyle }, [minEl]),
        el("td", { style: tdStyle }, [maxEl]),
        el("td", { style: tdStyle }, [lblEl]),
        el("td", { style: tdStyle }, [eqEl]),
      ]);
    });
    const tdStyle = "padding:4px 8px";
    const tbl = el("table", { style: { width: "100%", borderCollapse: "collapse" } }, [
      el("thead", {}, [
        el("tr", {}, ["Desde", "Hasta", "Nivel académico", "Calificación eq."].map((h) =>
          el("th", { text: h, style: "text-align:left;padding:6px 8px;font-size:0.8rem;color:var(--color-text-muted);font-weight:600;text-transform:uppercase" })
        )),
      ]),
      el("tbody", {}, inputs),
    ]);

    scaleBody.append(
      tbl,
      el("div", { class: "btn-row mt-3" }, [
        el("button", {
          class: "btn btn--primary btn--sm",
          text: "Guardar escala",
          onclick: () => {
            saveScale(workingScale);
            ctx.scale = workingScale;
            toast("Escala guardada. Los nuevos PDF usarán esta escala.", "success");
          },
        }),
        el("button", {
          class: "btn btn--ghost btn--sm",
          text: "Restablecer valores por defecto",
          onclick: () => {
            workingScale = DEFAULT_SCALE.map((s) => ({ ...s }));
            renderScaleTable();
          },
        }),
      ])
    );
  }
  renderScaleTable();

  container.append(
    el("div", { class: "card mb-6" }, [
      el("h3", { class: "card__title", text: "Configuración de escala de equivalencia" }),
      el("p", { class: "text-muted", style: { fontSize: "0.85rem", marginBottom: "var(--space-4)" },
        text: "Define cómo se convierten los puntos del concurso a calificación académica. Se guarda en este navegador." }),
      scaleBody,
    ])
  );

  // ── Informes por proyecto ─────────────────────────────────────
  container.append(el("h3", { style: { marginBottom: "var(--space-3)" }, text: "Informes por proyecto" }));

  const projectAvgs = projects
    .map((proj) => {
      const evals = evaluations.filter((e) => e.project_id === proj.id && e.total_score != null);
      const avg = evals.length ? evals.reduce((s, e) => s + Number(e.total_score), 0) / evals.length : null;
      return { proj, avg, evals };
    })
    .filter((x) => x.evals.length > 0)
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  if (!projectAvgs.length) {
    container.append(el("div", { class: "empty mb-5", text: "Ningún proyecto tiene evaluaciones enviadas." }));
  } else {
    const projGrid = el("div", { class: "flex-col gap-3 mb-6" });
    projectAvgs.forEach(({ proj, avg, evals }) => {
      const projTeamIds = [...new Set(evals.map((e) => e.team_id))];
      const projTeams = projTeamIds.map((id) => teamMap[id]).filter(Boolean)
        .map((t) => {
          const te = evals.filter((e) => e.team_id === t.id && e.total_score != null);
          const a = te.length ? te.reduce((s, e) => s + Number(e.total_score), 0) / te.length : null;
          return { ...t, avg: a };
        })
        .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

      const evIds = [...new Set(evals.map((e) => e.evaluator_id))];
      const jurorRows = evIds
        .map((evId) => {
          const evEvals = evals.filter((e) => e.evaluator_id === evId && e.total_score != null);
          const a = evEvals.length ? evEvals.reduce((s, e) => s + Number(e.total_score), 0) / evEvals.length : null;
          return { evId, name: evaluatorMap[evId] || "Jurado", count: evEvals.length, avg: a };
        })
        .filter((r) => r.avg != null && r.avg > 0)
        .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

      projGrid.append(
        el("div", { class: "card", style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" } }, [
          el("div", {}, [
            el("p", { style: { fontWeight: 700, margin: 0 }, text: proj.name }),
            el("p", { class: "text-muted", style: { margin: "2px 0 0", fontSize: "0.83rem" } },
              [`Promedio: ${fmtScore(avg)}  ·  ${projTeams.length} equipos  ·  ${jurorRows.length} jurados`]),
          ]),
          el("button", {
            class: "btn btn--primary btn--sm",
            text: "⬇ PDF del proyecto",
            onclick: (e) => generateProjectPDF({
              btn: e.currentTarget, proj,
              projTeams, projEvals: evals, jurorRows,
              teamMap, evaluatorMap, answersByEval, membersByTeam, scale: ctx.scale,
            }),
          }),
        ])
      );
    });
    container.append(projGrid);
  }

  // ── Informes por equipo ───────────────────────────────────────
  container.append(el("h3", { style: { marginTop: "var(--space-5)", marginBottom: "var(--space-3)" }, text: "Informes individuales por equipo" }));

  let teamFilter2 = "";
  const searchEl2 = searchInput("Buscar equipo…", (val) => {
    teamFilter2 = val;
    renderTeamReportList();
  });
  container.append(searchEl2);

  const teamListRoot = el("div", { class: "flex-col gap-3 mt-4" });
  container.append(teamListRoot);

  function renderTeamReportList() {
    clear(teamListRoot);

    const allTeams = projects.flatMap((proj) => {
      const projEvals = evaluations.filter((e) => e.project_id === proj.id);
      const tIds = [...new Set(projEvals.map((e) => e.team_id))];
      return tIds
        .map((id) => {
          const team = teamMap[id];
          if (!team) return null;
          const te = projEvals.filter((e) => e.team_id === id && e.total_score != null);
          const avg = te.length ? te.reduce((s, e) => s + Number(e.total_score), 0) / te.length : null;
          return { team, proj, teamEvals: projEvals.filter((e) => e.team_id === id), avg };
        })
        .filter(Boolean);
    })
      .filter((x) => !teamFilter2 || x.team.name.toLowerCase().includes(teamFilter2.toLowerCase()))
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

    if (!allTeams.length) {
      teamListRoot.append(el("div", { class: "empty", text: "Ningún equipo tiene evaluaciones enviadas." }));
      return;
    }

    allTeams.forEach(({ team, proj, teamEvals, avg }, rank) => {
      const equiv = getEquivalent(avg, ctx.scale);
      teamListRoot.append(
        el("div", { class: "card", style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" } }, [
          el("div", {}, [
            el("p", { style: { fontWeight: 700, margin: 0 } }, [
              el("span", { style: { color: "var(--color-text-muted)", marginRight: "6px", fontSize: "0.85rem" }, text: `#${rank + 1}` }),
              team.name,
            ]),
            el("p", { class: "text-muted", style: { margin: "2px 0 0", fontSize: "0.83rem" } },
              [`${proj.name}  ·  Prom: ${fmtScore(avg)}  ·  ${equiv.label !== "—" ? `${equiv.label} → ${fmtScore(equiv.equivalent)}` : "sin escala"}`]),
          ]),
          el("div", { class: "flex gap-2", style: { flexWrap: "wrap" } }, [
            el("button", {
              class: "btn btn--primary btn--sm",
              text: "⬇ PDF del equipo",
              onclick: (e) => generateTeamPDF({ btn: e.currentTarget, team, proj, teamEvals, evaluatorMap, answersByEval, membersByTeam, scale: ctx.scale }),
            }),
            el("button", {
              class: "btn btn--accent btn--sm",
              text: "⬇ CSV Ludens",
              onclick: (e) => generateTeamCSV({ btn: e.currentTarget, team, proj, teamEvals, membersByTeam, scale: ctx.scale }),
            }),
          ]),
        ])
      );
    });
  }

  renderTeamReportList();
}

// ══════════════════════════════════════════════════════════════
//  Generación de PDF: Proyecto completo
// ══════════════════════════════════════════════════════════════
async function generateProjectPDF({ btn, proj, projTeams, projEvals, jurorRows, teamMap, evaluatorMap, answersByEval, membersByTeam, scale }) {
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
  try {
    const { jsPDF } = await loadJsPDF();
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const C = { heading: [30, 50, 100], sub: [60, 80, 140], muted: [110, 120, 150] };

    pdfHeader(doc, pageW, margin);
    let y = 28;

    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...C.heading);
    doc.text("Informe de Evaluaciones", margin, y); y += 7;
    doc.setFontSize(12); doc.setTextColor(...C.sub); doc.text(proj.name, margin, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.muted);
    doc.text(`Generado: ${fmtDateLong()}`, margin, y); y += 8;
    doc.setDrawColor(180, 195, 230); doc.line(margin, y, pageW - margin, y); y += 8;

    // Resumen
    const projScores = projEvals.filter((e) => e.total_score != null).map((e) => Number(e.total_score));
    const projAvg = projScores.length ? projScores.reduce((a, b) => a + b, 0) / projScores.length : null;
    const { label: projLevel } = getEquivalent(projAvg, scale);

    pdfSectionTitle(doc, "Resumen del proyecto", margin, y); y += 3;
    doc.autoTable({
      startY: y,
      head: [["Indicador", "Valor"]],
      body: [
        ["Promedio general", fmtScore(projAvg)],
        ["Equivalencia académica", projLevel],
        ["Equipos calificados", projTeams.length],
        ["Jurados evaluadores", jurorRows.length],
        ["Total evaluaciones", projEvals.length],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 50, 120], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 244, 255] },
      margin: { left: margin, right: margin }, theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 10;

    // Tabla de jurados
    pdfSectionTitle(doc, "Calificaciones por jurado", margin, y); y += 3;
    doc.autoTable({
      startY: y,
      head: [["#", "Jurado", "Equipos", "Promedio"]],
      body: jurorRows.map((r, i) => [`#${i + 1}`, r.name, r.count, fmtScore(r.avg)]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 50, 120], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 244, 255] },
      columnStyles: { 0: { cellWidth: 12 }, 2: { halign: "center" }, 3: { halign: "center" } },
      margin: { left: margin, right: margin }, theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 12;

    // Detalle por equipo (ordenado por avg desc)
    pdfSectionTitle(doc, "Detalle por equipo", margin, y); y += 6;

    for (const team of projTeams) {
      const teamEvals = projEvals.filter((e) => e.team_id === team.id && e.total_score != null)
        .sort((a, b) => Number(b.total_score) - Number(a.total_score));
      if (!teamEvals.length) continue;

      const teamAvg = teamEvals.reduce((s, e) => s + Number(e.total_score), 0) / teamEvals.length;
      const { label: lvl, equivalent: eq } = getEquivalent(teamAvg, scale);
      const mems = membersByTeam[team.id] || [];

      if (y > 240) { doc.addPage(); y = 20; }

      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...C.sub);
      doc.text(team.name, margin, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.muted);
      doc.text(`Prom: ${fmtScore(teamAvg)}  |  ${lvl}${eq ? ` → ${fmtScore(eq)}` : ""}`, margin + 60, y);
      if (team.gradeLabel) doc.text(`Grado: ${team.gradeLabel}`, margin + 120, y);
      y += 2;

      // Integrantes
      if (mems.length) {
        doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...C.muted);
        doc.text("Integrantes: " + mems.map((m) => m.full_name).join("  ·  "), margin, y + 4, { maxWidth: pageW - margin * 2 });
        y += mems.length > 2 ? 9 : 6;
      }
      y += 2;

      const tableBody = teamEvals.map((ev, i) => {
        const answers = answersByEval[ev.id] || [];
        const obs = answers
          .filter((a) => a.observation?.trim())
          .map((a) => (a.item_key ? `[${a.item_key}] ${a.observation.trim()}` : a.observation.trim()))
          .join("\n\n");
        return [`#${i + 1}`, evaluatorMap[ev.evaluator_id] || "—", fmtScore(ev.total_score), obs || "Sin observaciones"];
      });

      doc.autoTable({
        startY: y,
        head: [["#", "Jurado", "Puntaje", "Observaciones / Feedback"]],
        body: tableBody,
        styles: { fontSize: 8, cellPadding: 3, valign: "top", overflow: "linebreak" },
        headStyles: { fillColor: [60, 90, 170], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 36 }, 2: { cellWidth: 18, halign: "center" }, 3: { cellWidth: "auto" } },
        margin: { left: margin, right: margin }, theme: "striped",
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    pdfFooter(doc, pageW);
    const safeName = proj.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/, "");
    doc.save(`informe-proyecto-${safeName}.pdf`);
    toast("PDF descargado correctamente", "success");
  } catch (err) {
    console.error("[analytics] PDF error", err);
    toast("Error al generar el PDF: " + (err?.message || err), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇ PDF del proyecto"; }
  }
}

// ══════════════════════════════════════════════════════════════
//  Generación de PDF: Equipo individual
// ══════════════════════════════════════════════════════════════
async function generateTeamPDF({ btn, team, proj, teamEvals, evaluatorMap, answersByEval, membersByTeam, scale }) {
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
  try {
    const { jsPDF } = await loadJsPDF();
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const C = { heading: [30, 50, 100], sub: [60, 80, 140], muted: [110, 120, 150] };

    pdfHeader(doc, pageW, margin);
    let y = 28;

    const scored = teamEvals.filter((e) => e.total_score != null);
    const teamAvg = scored.length ? scored.reduce((s, e) => s + Number(e.total_score), 0) / scored.length : null;
    const { label: lvl, equivalent: eq } = getEquivalent(teamAvg, scale);
    const mems = membersByTeam[team.id] || [];

    // Título
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...C.heading);
    doc.text("Informe Individual de Equipo", margin, y); y += 7;
    doc.setFontSize(12); doc.setTextColor(...C.sub); doc.text(team.name, margin, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.muted);
    doc.text(`Proyecto: ${proj.name}  ·  Generado: ${fmtDateLong()}`, margin, y); y += 8;
    doc.setDrawColor(180, 195, 230); doc.line(margin, y, pageW - margin, y); y += 8;

    // Datos del equipo
    pdfSectionTitle(doc, "Datos del equipo", margin, y); y += 3;
    const teamDataBody = [
      ["Equipo", team.name],
      ["Proyecto", proj.name],
    ];
    if (team.gradeLabel) teamDataBody.push(["Grado", team.gradeLabel]);
    if (team.room) teamDataBody.push(["Salón / Sala", team.room]);
    if (team.presentationOrder) teamDataBody.push(["Orden de presentación", String(team.presentationOrder)]);
    teamDataBody.push(
      ["Puntaje promedio obtenido", fmtScore(teamAvg)],
      ["Equivalencia académica", lvl],
      ["Calificación equivalente", eq ? fmtScore(eq) : "—"],
    );
    doc.autoTable({
      startY: y, head: [["Campo", "Valor"]], body: teamDataBody,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 50, 120], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 244, 255] },
      margin: { left: margin, right: margin }, theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 10;

    // Integrantes
    if (mems.length) {
      pdfSectionTitle(doc, "Integrantes del equipo", margin, y); y += 3;
      doc.autoTable({
        startY: y, head: [["#", "Nombre completo", "Grado"]],
        body: mems.map((m, i) => [`${i + 1}`, m.full_name, team.gradeLabel || "—"]),
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [30, 50, 120], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [240, 244, 255] },
        columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 28, halign: "center" } },
        margin: { left: margin, right: margin }, theme: "striped",
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // Puntajes por jurado
    pdfSectionTitle(doc, "Calificaciones por jurado", margin, y); y += 3;
    const jurorBody = scored
      .sort((a, b) => Number(b.total_score) - Number(a.total_score))
      .map((ev, i) => {
        const { label: jLvl, equivalent: jEq } = getEquivalent(ev.total_score, scale);
        return [`#${i + 1}`, evaluatorMap[ev.evaluator_id] || "—", fmtScore(ev.total_score), jLvl, jEq ? fmtScore(jEq) : "—"];
      });

    doc.autoTable({
      startY: y,
      head: [["#", "Jurado", "Puntaje", "Nivel", "Calificación eq."]],
      body: jurorBody,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [60, 90, 170], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      columnStyles: {
        0: { cellWidth: 10 }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" },
      },
      margin: { left: margin, right: margin }, theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 10;

    // Promedio final destacado
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFillColor(30, 50, 120);
    doc.roundedRect(margin, y, pageW - margin * 2, 20, 4, 4, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
    doc.text(`Promedio final: ${fmtScore(teamAvg)}  →  ${lvl}  (${eq ? fmtScore(eq) : "—"})`, pageW / 2, y + 12, { align: "center" });
    y += 28;

    // Observaciones / feedback por jurado
    const evalsWithObs = scored.filter((ev) => (answersByEval[ev.id] || []).some((a) => a.observation?.trim()));
    if (evalsWithObs.length) {
      if (y > 240) { doc.addPage(); y = 20; }
      pdfSectionTitle(doc, "Observaciones y feedback", margin, y); y += 3;

      const obsBody = evalsWithObs
        .sort((a, b) => Number(b.total_score) - Number(a.total_score))
        .map((ev) => {
          const obs = (answersByEval[ev.id] || [])
            .filter((a) => a.observation?.trim())
            .map((a) => (a.item_key ? `[${a.item_key}] ${a.observation.trim()}` : a.observation.trim()))
            .join("\n\n");
          return [evaluatorMap[ev.evaluator_id] || "—", fmtScore(ev.total_score), obs];
        });

      doc.autoTable({
        startY: y,
        head: [["Jurado", "Puntaje", "Observaciones"]],
        body: obsBody,
        styles: { fontSize: 8, cellPadding: 3, valign: "top", overflow: "linebreak" },
        headStyles: { fillColor: [60, 90, 170], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 20, halign: "center" }, 2: { cellWidth: "auto" } },
        margin: { left: margin, right: margin }, theme: "striped",
      });
    }

    pdfFooter(doc, pageW);
    const safeName = team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/, "");
    doc.save(`informe-equipo-${safeName}.pdf`);
    toast("PDF del equipo descargado", "success");
  } catch (err) {
    console.error("[analytics] team PDF error", err);
    toast("Error al generar el PDF: " + (err?.message || err), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇ PDF"; }
  }
}

// ══════════════════════════════════════════════════════════════
//  Generación de CSV: Equipo → Ludens
// ══════════════════════════════════════════════════════════════
async function generateTeamCSV({ btn, team, proj, teamEvals, membersByTeam, scale }) {
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
  try {
    const mems = membersByTeam[team.id] || [];
    if (!mems.length) {
      toast("Este equipo no tiene integrantes registrados.", "warning");
      return;
    }

    const scored = teamEvals.filter((e) => e.total_score != null);
    const teamAvg = scored.length
      ? scored.reduce((s, e) => s + Number(e.total_score), 0) / scored.length
      : null;
    const { equivalent: eq } = getEquivalent(teamAvg, scale);
    const grade = team.gradeLabel || "";

    // Cabecera + filas. Nota: "nombre primer_apellido" por heurística de splits.
    const rows = [
      ["Grado", "Nombre y primer apellido", "Calificacion equivalente", "Nombre completo (referencia)", "Equipo"],
      ...mems.map((m) => [grade, ludensName(m.full_name), eq != null ? String(eq) : "", m.full_name, team.name]),
    ];

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/, "");
    a.download = `ludens-${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    toast("CSV descargado correctamente", "success");
  } catch (err) {
    console.error("[analytics] CSV error", err);
    toast("Error al generar el CSV: " + (err?.message || err), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇ CSV"; }
  }
}

// ══════════════════════════════════════════════════════════════
//  Utilidades de PDF
// ══════════════════════════════════════════════════════════════
function pdfHeader(doc, pageW, margin) {
  doc.setFillColor(20, 35, 80);
  doc.rect(0, 0, pageW, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(200, 210, 240);
  doc.text("FERIA STEAM · Seminario Diocesano Cristo Sacerdote", margin, 9);
}

function pdfFooter(doc, pageW) {
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFillColor(20, 35, 80);
    doc.rect(0, 285, pageW, 12, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(180, 195, 230);
    doc.text(`Feria STEAM · Informe confidencial · Pág ${i} / ${n}`, pageW / 2, 292, { align: "center" });
  }
}

function pdfSectionTitle(doc, text, x, y) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30, 50, 100);
  doc.text(text, x, y);
}

function fmtDateLong() {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeStyle: "short" }).format(new Date());
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

function sectionLabel(text) {
  return el("p", {
    style: {
      fontSize: "0.78rem", fontWeight: 600, color: "var(--color-text-muted)",
      textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--space-2)",
    },
    text,
  });
}

function buildTable(headers, rows) {
  const th = (text) => el("th", {
    text,
    style: "text-align:left;padding:8px 10px;font-size:0.77rem;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap",
  });
  const td = (text) => el("td", {
    text: String(text ?? "—"),
    style: "padding:8px 10px;font-size:0.9rem;border-bottom:1px solid var(--color-border)",
  });
  const tbody = el("tbody", {});
  rows.forEach((row) => tbody.append(el("tr", {}, row.map(td))));
  return el("table", { style: "width:100%;border-collapse:collapse" }, [
    el("thead", {}, [el("tr", {}, headers.map(th))]),
    tbody,
  ]);
}

function searchInput(placeholder, onInput) {
  const inp = el("input", {
    class: "input",
    type: "search",
    placeholder,
    style: "max-width:320px;margin-bottom:var(--space-4)",
  });
  inp.addEventListener("input", () => onInput(inp.value.trim()));
  return inp;
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
        callbacks: {
          label: (c) => ` ${c.dataset.label ?? ""}: ${c.parsed.y?.toFixed ? c.parsed.y.toFixed(2) : c.parsed.y}`,
        },
      },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#a4afc8" } },
      x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#a4afc8", maxRotation: 30 } },
    },
  };
}
