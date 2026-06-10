import { clear, el, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import { listRanking, listFieldCompetitions, listFieldResultsByCompetition } from "../data.js?v=19";
import { subscribeTable } from "../realtime.js?v=19";
import { supabase } from "../supabase.js?v=19";

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
        await paintFieldComp(detail, fieldComps.find((c) => c.id === compId), results);
      } catch (err) { clear(detail); detail.append(el("div", { class: "error-banner", text: err?.message })); }
    }
  }

  async function paintFieldComp(container, comp, results) {
    if (!comp) return;

    // Traer scores de team_score_cache para incluir sustentación
    let cacheRows = [];
    try {
      const { data } = await supabase
        .from("team_score_cache")
        .select("team_id, sustentation_avg, field_contest_avg, total_score")
        .eq("edition_id", edition.id);
      cacheRows = data ?? [];
    } catch {}
    const cacheByTeam = {};
    cacheRows.forEach((r) => { cacheByTeam[r.team_id] = r; });

    // Acumular por equipo con desglose de ronda 0 (Func/Deco/Bonus)
    const totals = {};
    results.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      const name = r.team?.name || "?";
      if (!totals[tid]) totals[tid] = { name, pts: 0, func: 0, deco: 0, bonus: 0, rondas: 0, rounds: {} };
      const pts = Number(r.computed_points) || 0;
      totals[tid].pts += pts;
      const rn = r.round?.round_number ?? "?";
      if (rn === 0) {
        totals[tid].func = r.meta?.funcionalidad || 0;
        totals[tid].deco = r.meta?.decoracion || 0;
        totals[tid].bonus = r.meta?.bonus || 0;
      } else {
        totals[tid].rondas += pts;
        totals[tid].rounds[rn] = (totals[tid].rounds[rn] || 0) + pts;
      }
    });

    // Detectar si hay datos de ronda 0 (evaluación prototipo)
    const hasPreScores = Object.values(totals).some((t) => t.func || t.deco || t.bonus);

    // Ordenar por total combinado (sustentación + campo)
    const sorted = Object.entries(totals).sort((a, b) => {
      const totalA = (cacheByTeam[a[0]]?.total_score ?? a[1].pts);
      const totalB = (cacheByTeam[b[0]]?.total_score ?? b[1].pts);
      return totalB - totalA;
    });
    if (!sorted.length) { container.append(el("div", { class: "empty", text: "Sin resultados aún." })); return; }

    // Obtener rondas normales únicas (excluyendo ronda 0)
    const roundNums = [...new Set(results.map((r) => r.round?.round_number).filter((n) => n != null && n > 0))].sort((a, b) => a - b);

    // Header dinámico
    const headerCols = [
      el("span", { style: "width:28px;text-align:center", text: "#" }),
      el("span", { style: "flex:1;min-width:80px", text: "Equipo" }),
      el("span", { style: "width:35px;text-align:center", text: "S" }),
    ];
    if (hasPreScores) {
      headerCols.push(
        el("span", { style: "width:34px;text-align:center", text: "Fn" }),
        el("span", { style: "width:34px;text-align:center", text: "Dc" }),
        el("span", { style: "width:30px;text-align:center", text: "Bn" }),
      );
    }
    roundNums.forEach((n) => headerCols.push(el("span", { style: "width:34px;text-align:center", text: `R${n}` })));
    headerCols.push(
      el("span", { style: "width:40px;text-align:center", text: "Camp" }),
      el("span", { style: "width:48px;text-align:center;font-weight:700", text: "Total" }),
    );

    container.append(el("div", {
      style: "font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted);padding:var(--space-2);display:flex;gap:var(--space-1);border-bottom:2px solid var(--color-border);overflow-x:auto",
    }, headerCols));

    sorted.forEach(([tid, data], idx) => {
      const cache = cacheByTeam[tid];
      const sustAvg = cache?.sustentation_avg ?? 0;
      const totalCombined = cache?.total_score ?? (sustAvg + data.pts);

      const rowCols = [
        el("span", { style: "width:28px;text-align:center;font-weight:700", text: `${idx + 1}` }),
        el("span", { style: "flex:1;min-width:80px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", text: data.name }),
        el("span", { style: "width:35px;text-align:center;font-size:0.8rem;color:var(--color-text-muted)", text: fmtScore(sustAvg) }),
      ];
      if (hasPreScores) {
        rowCols.push(
          el("span", { style: "width:34px;text-align:center;font-size:0.8rem", text: String(data.func) }),
          el("span", { style: "width:34px;text-align:center;font-size:0.8rem", text: String(data.deco) }),
          el("span", { style: "width:30px;text-align:center;font-size:0.8rem;color:var(--color-warning)", text: String(data.bonus) }),
        );
      }
      roundNums.forEach((n) => rowCols.push(el("span", { style: "width:34px;text-align:center;font-size:0.8rem", text: data.rounds[n] != null ? String(data.rounds[n]) : "-" })));
      rowCols.push(
        el("span", { style: "width:40px;text-align:center;font-size:0.8rem", text: String(data.pts) }),
        el("span", { style: "width:48px;text-align:center;font-weight:700;color:var(--color-accent)", text: fmtScore(totalCombined) }),
      );

      container.append(el("div", {
        style: `display:flex;align-items:center;padding:var(--space-2);gap:var(--space-1);border-bottom:1px solid var(--color-border);overflow-x:auto;${idx < 3 ? "background:var(--color-surface-2)" : ""}`,
      }, rowCols));
    });
  }

  // ── Realtime ──────────────────────────────────────────────────
  unsub = subscribeTable({
    table: "team_score_cache",
    filter: `edition_id=eq.${edition.id}`,
    onChange: () => { if (currentTab === "global") paintGlobal(); },
  });

  const unsubField = subscribeTable({
    table: "field_results",
    onChange: () => { if (currentTab === "field") paintFieldTab(); },
  });

  await paintGlobal();

  return { cleanup: () => { unsub?.(); unsubField?.(); } };
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
