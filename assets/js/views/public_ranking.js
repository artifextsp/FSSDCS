import { clear, el, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import { listRanking, listFieldCompetitions, listFieldResultsByCompetition } from "../data.js?v=19";
import { subscribeTable } from "../realtime.js?v=19";

const TYPE_LABELS = {
  time_trial: "Prueba de tiempo",
  performance: "Desempeño",
  combat: "Combate",
  elimination: "Eliminación",
  timed_quantity: "Cantidad en tiempo",
};

export async function renderRanking() {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);
  const edition = getCurrentEdition();

  wrap.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h1", { text: "Ranking en vivo" }),
      el("p", { class: "text-muted", text: edition ? `Edición ${edition.year} · ${edition.name}` : "Sin edición activa" }),
    ]),
    el("span", { class: "pill pill--accent", text: "Tiempo real" }),
  ]));

  if (!edition) {
    wrap.append(el("div", { class: "empty", text: "No hay edición activa." }));
    return;
  }

  // Tabs: Global | Por competencia
  const tabBar = el("div", { class: "tabs", style: "margin-bottom:var(--space-4)" });
  const btnGlobal = el("button", { class: "tab is-active", text: "Ranking Global", onclick: () => switchTab("global") });
  const btnField = el("button", { class: "tab", text: "Por Competencia", onclick: () => switchTab("field") });
  tabBar.append(btnGlobal, btnField);
  wrap.append(tabBar);

  const content = el("div");
  wrap.append(content);

  let currentTab = "global";
  let unsub = null;
  let fieldComps = [];

  try { fieldComps = await listFieldCompetitions(edition.id); } catch { fieldComps = []; }

  async function switchTab(tab) {
    currentTab = tab;
    btnGlobal.classList.toggle("is-active", tab === "global");
    btnField.classList.toggle("is-active", tab === "field");
    if (tab === "global") await paintGlobal();
    else await paintFieldTab();
  }

  // ── GLOBAL ────────────────────────────────────────────────────
  async function paintGlobal() {
    clear(content);
    const list = el("div", { class: "flex-col gap-5" });
    content.append(list);
    try { paintGlobalData(list, await listRanking(edition.id)); }
    catch { paintGlobalData(list, []); }
  }

  function paintGlobalData(list, rows) {
    clear(list);
    if (!rows.length) { list.append(el("div", { class: "empty", text: "Aún no hay puntajes registrados." })); return; }

    const projectOrder = [];
    const byProject = {};
    rows.forEach((r) => {
      if (!byProject[r.project_id]) { projectOrder.push(r.project_id); byProject[r.project_id] = { name: r.project_name, teams: [] }; }
      byProject[r.project_id].teams.push(r);
    });
    projectOrder.forEach((pid) => byProject[pid].teams.sort((a, b) => a.project_rank - b.project_rank));
    projectOrder.sort((a, b) => byProject[a].name.localeCompare(byProject[b].name, "es", { sensitivity: "base" }));

    projectOrder.forEach((pid) => {
      const { name, teams } = byProject[pid];
      const section = el("div", { class: "ranking-project" });
      section.append(
        el("div", { class: "ranking-project__header" }, [
          el("h2", { class: "ranking-project__title", text: name }),
          el("span", { class: "pill pill--ghost", text: `${teams.length} equipo${teams.length !== 1 ? "s" : ""}` }),
        ])
      );

      // Tabla con columnas S / C / T
      const table = el("div", { class: "flex-col gap-1" });
      table.append(el("div", {
        class: "flex",
        style: "font-size:0.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted);padding:0 var(--space-2);gap:var(--space-2)",
      }, [
        el("span", { style: "width:30px;text-align:center", text: "#" }),
        el("span", { style: "flex:1", text: "Equipo" }),
        el("span", { style: "width:55px;text-align:center", text: "S" }),
        el("span", { style: "width:55px;text-align:center", text: "C" }),
        el("span", { style: "width:60px;text-align:center;font-weight:700", text: "Total" }),
      ]));
      teams.forEach((r) => table.append(rankRow(r)));
      section.append(table);
      list.append(section);
    });
  }

  // ── POR COMPETENCIA ────────────────────────────────────────────
  async function paintFieldTab() {
    clear(content);
    if (!fieldComps.length) { content.append(el("div", { class: "empty", text: "No hay competencias de campo configuradas." })); return; }

    const filterRow = el("div", { class: "flex gap-2 mb-4", style: "flex-wrap:wrap" });
    const compSelect = el("select", { class: "select", style: "max-width:300px" });
    fieldComps.forEach((fc) => compSelect.append(el("option", { value: fc.id, text: `${fc.project?.name || "—"} (${TYPE_LABELS[fc.competition_type] || fc.competition_type})` })));
    filterRow.append(el("label", { style: "font-weight:600;align-self:center", text: "Competencia:" }), compSelect);
    content.append(filterRow);

    const detail = el("div");
    content.append(detail);

    compSelect.addEventListener("change", () => loadComp(compSelect.value));
    if (compSelect.value) loadComp(compSelect.value);

    async function loadComp(compId) {
      clear(detail);
      detail.append(el("div", { class: "loading-screen" }, [el("div", { class: "spinner" })]));
      try {
        const results = await listFieldResultsByCompetition(compId);
        clear(detail);
        paintFieldComp(detail, fieldComps.find((c) => c.id === compId), results);
      } catch (err) { clear(detail); detail.append(el("div", { class: "error-banner", text: err?.message })); }
    }
  }

  function paintFieldComp(container, comp, results) {
    if (!comp) return;

    // Acumular por equipo
    const totals = {};
    results.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      const name = r.team?.name || "?";
      if (!totals[tid]) totals[tid] = { name, pts: 0, rounds: {} };
      totals[tid].pts += Number(r.computed_points) || 0;
      const rn = r.round?.round_number ?? "?";
      totals[tid].rounds[rn] = Number(r.computed_points) || 0;
    });

    const sorted = Object.entries(totals).sort((a, b) => b[1].pts - a[1].pts);
    if (!sorted.length) { container.append(el("div", { class: "empty", text: "Sin resultados aún." })); return; }

    // Obtener rondas únicas
    const roundNums = [...new Set(results.map((r) => r.round?.round_number).filter((n) => n != null))].sort((a, b) => a - b);

    // Header
    const headerRow = el("div", {
      class: "flex",
      style: "font-size:0.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted);padding:var(--space-2);gap:var(--space-2);border-bottom:2px solid var(--color-border)",
    }, [
      el("span", { style: "width:30px;text-align:center", text: "#" }),
      el("span", { style: "flex:1", text: "Equipo" }),
      ...roundNums.map((n) => el("span", { style: "width:45px;text-align:center", text: `R${n}` })),
      el("span", { style: "width:55px;text-align:center;font-weight:700", text: "Total" }),
    ]);
    container.append(headerRow);

    sorted.forEach(([tid, data], idx) => {
      const row = el("div", {
        class: "flex items-center",
        style: `padding:var(--space-2);gap:var(--space-2);border-bottom:1px solid var(--color-border);${idx < 3 ? "background:var(--color-surface-2)" : ""}`,
      }, [
        el("span", { style: "width:30px;text-align:center;font-weight:700", text: `${idx + 1}` }),
        el("span", { style: "flex:1;font-weight:500", text: data.name }),
        ...roundNums.map((n) => el("span", { style: "width:45px;text-align:center;font-size:0.85rem", text: data.rounds[n] != null ? String(data.rounds[n]) : "—" })),
        el("span", { style: "width:55px;text-align:center;font-weight:700;color:var(--color-accent)", text: String(data.pts) }),
      ]);
      container.append(row);
    });
  }

  // ── Realtime ──────────────────────────────────────────────────
  unsub = subscribeTable({
    table: "team_score_cache",
    filter: `edition_id=eq.${edition.id}`,
    onChange: () => { if (currentTab === "global") paintGlobal(); },
  });

  await paintGlobal();

  return { cleanup: () => unsub?.() };
}

function rankRow(r) {
  const posClass = r.project_rank <= 3 ? ` rank-row__pos--${r.project_rank}` : "";
  return el("a", {
    class: "flex items-center",
    href: `#/equipos/${r.team_id}`,
    style: `text-decoration:none;color:inherit;padding:var(--space-2);gap:var(--space-2);border-bottom:1px solid var(--color-border);${r.project_rank <= 3 ? "background:var(--color-surface-2)" : ""}`,
  }, [
    el("span", { class: `rank-row__pos${posClass}`, style: "width:30px;text-align:center;font-weight:700", text: `${r.project_rank}` }),
    el("span", { style: "flex:1;font-weight:500", text: r.team_name }),
    el("span", { style: "width:55px;text-align:center;font-size:0.85rem", text: fmtScore(r.sustentation_avg) }),
    el("span", { style: "width:55px;text-align:center;font-size:0.85rem", text: fmtScore(r.field_contest_avg) }),
    el("span", { style: "width:60px;text-align:center;font-weight:700;color:var(--color-accent)", text: fmtScore(r.total_score) }),
  ]);
}
