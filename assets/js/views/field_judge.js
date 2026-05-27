import { el, clear, toast } from "../utils.js?v=19";
import { supabase } from "../supabase.js?v=19";
import { getAuthSnapshot } from "../auth.js?v=19";
import {
  getFieldCompetition, listFieldRounds, listFieldResults,
  createFieldRound, deleteFieldRound, upsertFieldResult, deleteFieldResult,
  listFieldResultsByCompetition,
} from "../data.js?v=19";
import { listTeamsByProject } from "../data.js?v=19";
import { subscribeTable } from "../realtime.js?v=19";

/* ================================================================
   Vista: Juez de Campo (#/campo/:competitionId)
   Muestra interfaz de registro según competition_type (strategy pattern).
   ================================================================ */

export async function renderFieldJudge(competitionId) {
  const main = document.querySelector("[data-app-main]");
  if (!main) return;
  clear(main);

  const section = el("section", { class: "container py-6" });
  main.append(section);

  section.append(el("div", { class: "loading-screen" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", { text: "Cargando competencia…" }),
  ]));

  let comp;
  try { comp = await getFieldCompetition(competitionId); }
  catch (err) { clear(section); section.append(el("div", { class: "error-banner", text: "Error: " + (err?.message || err) })); return; }

  if (!comp) { clear(section); section.append(el("div", { class: "error-banner", text: "Competencia no encontrada." })); return; }
  if (comp.status === "setup") { clear(section); section.append(el("div", { class: "error-banner", text: "Esta competencia aún no ha sido activada por el administrador." })); return; }

  const strategy = STRATEGIES[comp.competition_type];
  if (!strategy) { clear(section); section.append(el("div", { class: "error-banner", text: `Tipo de competencia "${comp.competition_type}" no soportado aún.` })); return; }

  clear(section);
  await strategy.render(section, comp);

  // Sección de fotos del juez de campo
  section.append(await buildPhotoSection(comp));

  // Realtime: refrescar cuando otros escriben resultados en esta competencia
  const unsub = subscribeTable({
    table: "field_results",
    onChange: (payload) => {
      if (renderFieldJudge._refreshTimer) clearTimeout(renderFieldJudge._refreshTimer);
      renderFieldJudge._refreshTimer = setTimeout(() => {
        clear(section);
        strategy.render(section, comp).then(() => {
          buildPhotoSection(comp).then((ps) => section.append(ps));
        });
      }, 1500);
    },
  });

  return { cleanup: () => unsub?.() };
}

async function buildPhotoSection(comp) {
  const { uploadTeamPhoto, listTeamPhotos, deleteTeamPhoto, signedPhotoUrl } = await import("../data.js?v=19");
  const { listTeamsByProject } = await import("../data.js?v=19");

  const wrap = el("div", { class: "card mt-6" });
  wrap.append(el("h3", { style: "margin:0 0 var(--space-3)", text: "📷 Fotos de la competencia" }));
  wrap.append(el("p", { class: "text-muted", style: "margin:0 0 var(--space-3);font-size:0.83rem", text: "Toma fotos de los equipos durante la competencia. Se comprimen automáticamente." }));

  // Selector de equipo + botón subir
  const teams = await listTeamsByProject(comp.project_id);
  const teamSelect = el("select", { class: "select", style: "max-width:200px" });
  teams.forEach((t) => teamSelect.append(el("option", { value: t.id, text: t.name })));

  const fileInput = el("input", { type: "file", accept: "image/*", capture: "environment", style: "display:none" });
  const uploadBtn = el("button", { class: "btn btn--accent btn--sm", text: "📷 Tomar/subir foto", onclick: () => fileInput.click() });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Subiendo…";
    try {
      await uploadTeamPhoto({ teamId: teamSelect.value, file, caption: `Campo: ${comp.project?.name || ""}` });
      toast("Foto subida", "success");
      refreshPhotos();
    } catch (err) { toast("Error: " + (err?.message || err), "error"); }
    finally { uploadBtn.disabled = false; uploadBtn.textContent = "📷 Tomar/subir foto"; fileInput.value = ""; }
  });

  wrap.append(el("div", { class: "flex gap-2 items-center mb-3", style: "flex-wrap:wrap" }, [teamSelect, uploadBtn, fileInput]));

  const photosGrid = el("div", { class: "flex gap-2", style: "flex-wrap:wrap;max-height:200px;overflow-y:auto" });
  wrap.append(photosGrid);

  async function refreshPhotos() {
    clear(photosGrid);
    const tid = teamSelect.value;
    if (!tid) return;
    try {
      const photos = await listTeamPhotos(tid);
      if (!photos.length) { photosGrid.append(el("span", { class: "text-muted", style: "font-size:0.82rem", text: "Sin fotos aún" })); return; }
      for (const photo of photos.slice(-8)) {
        try {
          const url = await signedPhotoUrl(photo.storage_path, 600);
          const img = el("img", { src: url, style: "width:80px;height:80px;object-fit:cover;border-radius:var(--radius-sm);cursor:pointer", onclick: () => window.open(url, "_blank") });
          photosGrid.append(img);
        } catch {}
      }
    } catch {}
  }

  teamSelect.addEventListener("change", refreshPhotos);
  refreshPhotos();

  return wrap;
}

/* ================================================================
   STRATEGIES – Cada tipo implementa { render(container, competition) }
   ================================================================ */

const STRATEGIES = {
  time_trial: { render: renderTimeTrial },
  performance: { render: renderPerformance },
  combat: { render: renderCombat },
  elimination: { render: renderElimination },
  timed_quantity: { render: renderTimedQuantity },
};

/* ──────────────────────────────────────────────────────────────────
   TIME TRIAL: menor tiempo → ranking por posición → puntos automáticos
   ────────────────────────────────────────────────────────────────── */

async function renderTimeTrial(container, comp) {
  const config = comp.config || {};
  const positions = config.positions || [{ place: 1, points: 10 }, { place: 2, points: 7 }, { place: 3, points: 5 }];
  const unit = config.unit || "segundos";
  const lowerIsBetter = config.lower_is_better !== false;

  let teams, rounds, allResults;
  try {
    [teams, rounds, allResults] = await Promise.all([
      listTeamsByProject(comp.project_id),
      listFieldRounds(comp.id),
      listFieldResultsByCompetition(comp.id),
    ]);
  } catch (err) { container.append(el("div", { class: "error-banner", text: "Error: " + err?.message })); return; }

  let activeRoundIdx = rounds.length ? rounds.length - 1 : -1;

  // Header
  container.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: comp.project?.name || "Competencia" }),
        el("p", { class: "text-muted", text: `Prueba de tiempo · ${teams.length} equipos · Unidad: ${unit}` }),
      ]),
      comp.status === "active"
        ? el("button", { class: "btn btn--primary", text: "+ Nueva ronda", onclick: addRound })
        : null,
    ])
  );

  // Puntos por posición
  container.append(el("div", { class: "mb-4", style: "font-size:0.83rem;color:var(--color-text-muted)" }, [
    el("strong", { text: "Puntos por posición: " }),
    ...positions.map((p) => el("span", { text: `${p.place}° = ${p.points}pts  ` })),
  ]));

  // Tabs de rondas + contenido
  const tabBar = el("div", { class: "tabs", style: "margin-bottom:var(--space-3);overflow-x:auto" });
  const roundContent = el("div");
  container.append(tabBar, roundContent);

  // Ranking acumulado al final
  const accumContainer = el("div", { class: "mt-4" });
  container.append(accumContainer);

  function renderRounds() {
    clear(tabBar);
    clear(roundContent);
    clear(accumContainer);

    if (!rounds.length) {
      roundContent.append(el("div", { class: "empty", text: "No hay rondas. Agrega una para comenzar." }));
      return;
    }

    // Tabs
    rounds.forEach((round, idx) => {
      const btn = el("button", {
        class: `tab${idx === activeRoundIdx ? " is-active" : ""}`,
        text: round.label || `Ronda ${round.round_number}`,
        onclick: () => { activeRoundIdx = idx; renderRounds(); },
      });
      tabBar.append(btn);
    });
    // Tab de resumen
    tabBar.append(el("button", {
      class: `tab${activeRoundIdx === -2 ? " is-active" : ""}`,
      style: "font-style:italic",
      text: "Acumulado",
      onclick: () => { activeRoundIdx = -2; renderRounds(); },
    }));

    if (activeRoundIdx === -2) {
      renderAccumulated();
      return;
    }

    const round = rounds[activeRoundIdx] || rounds[rounds.length - 1];
    const results = allResults.filter((r) => (r.round?.id || r.round_id) === round.id);
    roundContent.append(renderRoundCard(round, results));
  }

  function renderAccumulated() {
    const totals = {};
    teams.forEach((t) => { totals[t.id] = { name: t.name, pts: 0 }; });
    allResults.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      if (totals[tid]) totals[tid].pts += Number(r.computed_points) || 0;
    });
    const sorted = Object.values(totals).sort((a, b) => b.pts - a.pts);
    const card = el("div", { class: "card" });
    card.append(el("h3", { style: "margin:0 0 var(--space-3)", text: "Ranking acumulado (todas las rondas)" }));
    sorted.forEach((t, i) => {
      card.append(el("div", {
        style: `display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--color-border);font-size:0.9rem;${i < 3 ? "font-weight:600" : ""}`,
      }, [
        el("span", { text: `${i + 1}. ${t.name}` }),
        el("span", { style: "color:var(--color-accent)", text: `${t.pts} pts` }),
      ]));
    });
    roundContent.append(card);
  }

  function renderRoundCard(round, results) {
    const card = el("div", { class: "card" });
    card.append(el("div", {
      class: "flex items-center",
      style: "justify-content:space-between;margin-bottom:var(--space-3)",
    }, [
      el("h3", { style: "margin:0", text: round.label || `Ronda ${round.round_number}` }),
      comp.status === "active"
        ? el("button", {
            class: "btn btn--danger btn--sm",
            text: "Eliminar ronda",
            onclick: async () => {
              if (!confirm("¿Eliminar esta ronda y sus resultados?")) return;
              try {
                await deleteFieldRound(round.id);
                rounds = rounds.filter((r) => r.id !== round.id);
                allResults = allResults.filter((r) => (r.round?.id || r.round_id) !== round.id);
                activeRoundIdx = Math.max(0, rounds.length - 1);
                renderRounds();
                toast("Ronda eliminada", "success");
              } catch (err) { toast("Error: " + err?.message, "error"); }
            },
          })
        : null,
    ]));

    const tbody = el("div", { class: "flex-col gap-2" });

    // Ordenar equipos por ranking dentro de esta ronda
    const teamsSorted = [...teams].sort((a, b) => {
      const ra = results.find((r) => (r.team?.id || r.team_id) === a.id);
      const rb = results.find((r) => (r.team?.id || r.team_id) === b.id);
      if (!ra && !rb) return 0;
      if (!ra) return 1;
      if (!rb) return -1;
      return (rb.computed_points || 0) - (ra.computed_points || 0);
    });

    teamsSorted.forEach((team) => {
      const existing = results.find((r) => (r.team?.id || r.team_id) === team.id);
      const row = el("div", {
        class: "flex items-center gap-3",
        style: "padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)",
      });

      row.append(el("span", { style: "flex:1;font-weight:500", text: team.name }));
      const timeInput = el("input", {
        type: "number", step: "0.01", min: "0", class: "input", style: "width:100px",
        placeholder: unit,
        value: existing?.raw_value != null ? String(existing.raw_value) : "",
      });
      const ptsEl = el("span", {
        class: "badge", style: "min-width:50px;text-align:center",
        text: existing ? `${existing.computed_points} pts` : "—",
      });

      if (comp.status === "active") {
        timeInput.addEventListener("change", async () => {
          const val = parseFloat(timeInput.value);
          if (isNaN(val) || val < 0) return;
          try {
            const pts = computeTimeTrialPoints(round, teams, allResults, team.id, val, positions, lowerIsBetter);
            await upsertFieldResult({ roundId: round.id, teamId: team.id, rawValue: val, computedPoints: pts, meta: {} });
            const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === team.id);
            const newResult = { round_id: round.id, round: { id: round.id }, team_id: team.id, team: { id: team.id, name: team.name }, raw_value: val, computed_points: pts };
            if (idx >= 0) allResults[idx] = newResult; else allResults.push(newResult);
            await recalcRound(round);
            renderRounds();
          } catch (err) { toast("Error: " + err?.message, "error"); }
        });
      } else {
        timeInput.disabled = true;
      }

      row.append(timeInput, ptsEl);
      tbody.append(row);
    });

    card.append(tbody);

    // Mini ranking de la ronda
    const sorted = [...results].filter((r) => r.raw_value != null).sort((a, b) =>
      lowerIsBetter ? a.raw_value - b.raw_value : b.raw_value - a.raw_value
    );
    if (sorted.length) {
      const rankList = el("div", { style: "margin-top:var(--space-3);font-size:0.85rem;padding:var(--space-2);background:var(--color-surface-2);border-radius:var(--radius-sm)" });
      rankList.append(el("strong", { text: "Ranking ronda: " }));
      sorted.forEach((r, i) => {
        const name = r.team?.name || "Equipo";
        const posConfig = positions.find((p) => p.place === i + 1);
        rankList.append(el("span", {
          style: i < 3 ? "font-weight:600" : "",
          text: `${i + 1}° ${name} (${r.raw_value}${unit}${posConfig ? ` → ${posConfig.points}pts` : ""}) `,
        }));
      });
      card.append(rankList);
    }

    return card;
  }

  async function addRound() {
    const nextNum = rounds.length ? Math.max(...rounds.map((r) => r.round_number)) + 1 : 1;
    try {
      const newRound = await createFieldRound({ competitionId: comp.id, roundNumber: nextNum, label: `Ronda ${nextNum}` });
      rounds.push(newRound);
      activeRoundIdx = rounds.length - 1;
      renderRounds();
      toast(`Ronda ${nextNum} creada`, "success");
    } catch (err) { toast("Error: " + err?.message, "error"); }
  }

  async function recalcRound(round) {
    const roundResults = allResults.filter((r) => (r.round?.id || r.round_id) === round.id && r.raw_value != null);
    const sorted = [...roundResults].sort((a, b) =>
      lowerIsBetter ? a.raw_value - b.raw_value : b.raw_value - a.raw_value
    );
    // Empates: mismos tiempos = mismo puesto = mismos puntos
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].raw_value !== sorted[i - 1].raw_value) rank = i + 1;
      const posConfig = positions.find((p) => p.place === rank);
      const pts = posConfig ? posConfig.points : 0;
      if (sorted[i].computed_points !== pts) {
        await upsertFieldResult({ roundId: round.id, teamId: sorted[i].team?.id || sorted[i].team_id, rawValue: sorted[i].raw_value, computedPoints: pts, meta: {} });
        sorted[i].computed_points = pts;
        const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === (sorted[i].team?.id || sorted[i].team_id));
        if (idx >= 0) allResults[idx].computed_points = pts;
      }
    }
  }

  function computeTimeTrialPoints(round, teams, allResults, teamId, newVal, positions, lowerIsBetter) {
    const roundResults = allResults
      .filter((r) => (r.round?.id || r.round_id) === round.id && r.raw_value != null && (r.team?.id || r.team_id) !== teamId)
      .map((r) => ({ teamId: r.team?.id || r.team_id, val: r.raw_value }));
    roundResults.push({ teamId, val: newVal });
    roundResults.sort((a, b) => lowerIsBetter ? a.val - b.val : b.val - a.val);
    // Empates: si hay valores iguales antes, comparten posición
    let rank = 1;
    for (let i = 0; i < roundResults.length; i++) {
      if (i > 0 && roundResults[i].val !== roundResults[i - 1].val) rank = i + 1;
      if (roundResults[i].teamId === teamId) {
        const posConfig = positions.find((p) => p.place === rank);
        return posConfig ? posConfig.points : 0;
      }
    }
    return 0;
  }

  renderRounds();
}

/* ──────────────────────────────────────────────────────────────────
   PERFORMANCE: puntos acumulables por eventos/criterios
   El juez marca qué eventos cumplió cada equipo en cada ronda.
   computed_points = suma de puntos de los eventos logrados.
   ────────────────────────────────────────────────────────────────── */
async function renderPerformance(container, comp) {
  const config = comp.config || {};
  const events = config.events || [{ key: "event_1", label: "Evento 1", points: 2 }];

  let teams, rounds, allResults;
  try {
    [teams, rounds, allResults] = await Promise.all([
      listTeamsByProject(comp.project_id),
      listFieldRounds(comp.id),
      listFieldResultsByCompetition(comp.id),
    ]);
  } catch (err) { container.append(el("div", { class: "error-banner", text: "Error: " + err?.message })); return; }

  let activeRoundIdx = rounds.length ? rounds.length - 1 : -1;

  container.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: comp.project?.name || "Competencia" }),
        el("p", { class: "text-muted", text: `Desempeño con criterios · ${teams.length} equipos` }),
      ]),
      comp.status === "active"
        ? el("button", { class: "btn btn--primary", text: "+ Nueva ronda", onclick: addRound })
        : null,
    ])
  );

  container.append(el("div", { class: "mb-4", style: "font-size:0.83rem;color:var(--color-text-muted)" }, [
    el("strong", { text: "Criterios: " }),
    ...events.map((e) => el("span", { text: `${e.label} (${e.points}pts)  ` })),
  ]));

  const tabBar = el("div", { class: "tabs", style: "margin-bottom:var(--space-3);overflow-x:auto" });
  const roundContent = el("div");
  container.append(tabBar, roundContent);

  function renderRounds() {
    clear(tabBar);
    clear(roundContent);
    if (!rounds.length) { roundContent.append(el("div", { class: "empty", text: "No hay rondas." })); return; }

    rounds.forEach((round, idx) => {
      tabBar.append(el("button", {
        class: `tab${idx === activeRoundIdx ? " is-active" : ""}`,
        text: round.label || `Ronda ${round.round_number}`,
        onclick: () => { activeRoundIdx = idx; renderRounds(); },
      }));
    });
    tabBar.append(el("button", {
      class: `tab${activeRoundIdx === -2 ? " is-active" : ""}`,
      style: "font-style:italic", text: "Acumulado",
      onclick: () => { activeRoundIdx = -2; renderRounds(); },
    }));

    if (activeRoundIdx === -2) { renderAccumulated(); return; }

    const round = rounds[activeRoundIdx] || rounds[rounds.length - 1];
    const rr = allResults.filter((r) => (r.round?.id || r.round_id) === round.id);
    roundContent.append(renderRoundCard(round, rr));
  }

  function renderAccumulated() {
    const card = el("div", { class: "card" });
    card.append(el("h3", { style: "margin:0 0 var(--space-3)", text: "Ranking acumulado" }));
    const totals = {};
    teams.forEach((t) => { totals[t.id] = { name: t.name, pts: 0 }; });
    allResults.forEach((r) => { const tid = r.team?.id || r.team_id; if (totals[tid]) totals[tid].pts += Number(r.computed_points) || 0; });
    Object.values(totals).sort((a, b) => b.pts - a.pts).forEach((t, i) => {
      card.append(el("div", { style: `display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--color-border);${i < 3 ? "font-weight:600" : ""}` }, [
        el("span", { text: `${i + 1}. ${t.name}` }), el("span", { style: "color:var(--color-accent)", text: `${t.pts} pts` }),
      ]));
    });
    roundContent.append(card);
  }

  function renderRoundCard(round, results) {
    const card = el("div", { class: "card" });
    card.append(el("div", {
      class: "flex items-center",
      style: "justify-content:space-between;margin-bottom:var(--space-3)",
    }, [
      el("h3", { style: "margin:0", text: round.label || `Ronda ${round.round_number}` }),
      comp.status === "active"
        ? el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
            if (!confirm("¿Eliminar esta ronda?")) return;
            try { await deleteFieldRound(round.id); rounds = rounds.filter((r) => r.id !== round.id); allResults = allResults.filter((r) => (r.round?.id || r.round_id) !== round.id); activeRoundIdx = Math.max(0, rounds.length - 1); renderRounds(); toast("Eliminada", "success"); } catch (err) { toast(err?.message, "error"); }
          }})
        : null,
    ]));

    teams.forEach((team) => {
      const existing = results.find((r) => (r.team?.id || r.team_id) === team.id);
      const meta = existing?.meta || {};
      const row = el("div", { style: "padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)" });
      row.append(el("div", { style: "font-weight:600;margin-bottom:4px" }, [
        el("span", { text: team.name }),
        el("span", { class: "badge", style: "margin-left:8px", text: `${existing?.computed_points ?? 0} pts` }),
      ]));

      const checksRow = el("div", { class: "flex gap-3", style: "flex-wrap:wrap" });
      events.forEach((evt) => {
        const checked = !!meta[evt.key];
        const cb = el("label", { style: "display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:0.85rem" }, [
          el("input", {
            type: "checkbox", checked, disabled: comp.status !== "active",
            onchange: async (e) => {
              const newMeta = { ...meta, [evt.key]: e.target.checked };
              const pts = events.reduce((sum, ev) => sum + (newMeta[ev.key] ? ev.points : 0), 0);
              try {
                await upsertFieldResult({ roundId: round.id, teamId: team.id, rawValue: pts, computedPoints: pts, meta: newMeta });
                const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === team.id);
                const nr = { round_id: round.id, round: { id: round.id }, team_id: team.id, team: { id: team.id, name: team.name }, raw_value: pts, computed_points: pts, meta: newMeta };
                if (idx >= 0) allResults[idx] = nr; else allResults.push(nr);
                renderRounds();
              } catch (err) { toast(err?.message, "error"); }
            },
          }),
          el("span", { text: `${evt.label} (${evt.points})` }),
        ]);
        checksRow.append(cb);
      });
      row.append(checksRow);
      card.append(row);
    });

    return card;
  }

  async function addRound() {
    const nextNum = rounds.length ? Math.max(...rounds.map((r) => r.round_number)) + 1 : 1;
    try { const nr = await createFieldRound({ competitionId: comp.id, roundNumber: nextNum, label: `Ronda ${nextNum}` }); rounds.push(nr); activeRoundIdx = rounds.length - 1; renderRounds(); toast(`Ronda ${nextNum}`, "success"); } catch (err) { toast(err?.message, "error"); }
  }

  renderRounds();
}

/* ──────────────────────────────────────────────────────────────────
   COMBAT: victoria/empate/derrota entre pares
   El juez selecciona dos equipos y registra ganador/empate por ronda.
   Cada combate se guarda como un result por equipo con meta indicando rival y outcome.
   ────────────────────────────────────────────────────────────────── */
async function renderCombat(container, comp) {
  const config = comp.config || {};
  const winPts = config.win_points ?? 3;
  const drawPts = config.draw_points ?? 1;
  const lossPts = config.loss_points ?? 0;

  let teams, rounds, allResults;
  try {
    [teams, rounds, allResults] = await Promise.all([
      listTeamsByProject(comp.project_id),
      listFieldRounds(comp.id),
      listFieldResultsByCompetition(comp.id),
    ]);
  } catch (err) { container.append(el("div", { class: "error-banner", text: "Error: " + err?.message })); return; }

  container.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: comp.project?.name || "Competencia" }),
        el("p", { class: "text-muted", text: `Combate · ${teams.length} equipos · V=${winPts} E=${drawPts} D=${lossPts}` }),
      ]),
      comp.status === "active"
        ? el("button", { class: "btn btn--primary", text: "+ Nueva ronda", onclick: addRound })
        : null,
    ])
  );

  const roundsContainer = el("div", { class: "flex-col gap-4" });
  container.append(roundsContainer);

  function renderRounds() {
    clear(roundsContainer);
    if (!rounds.length) { roundsContainer.append(el("div", { class: "empty", text: "No hay rondas." })); return; }
    rounds.forEach((round) => {
      const rr = allResults.filter((r) => (r.round?.id || r.round_id) === round.id);
      roundsContainer.append(renderCombatRound(round, rr));
    });

    // Tabla acumulada
    const accum = el("div", { class: "card mt-4" });
    accum.append(el("h3", { style: "margin:0 0 var(--space-3)", text: "Acumulado" }));
    const totals = {};
    teams.forEach((t) => { totals[t.id] = { name: t.name, pts: 0, w: 0, d: 0, l: 0 }; });
    allResults.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      if (totals[tid]) {
        totals[tid].pts += Number(r.computed_points) || 0;
        const o = r.meta?.outcome;
        if (o === "win") totals[tid].w++;
        else if (o === "draw") totals[tid].d++;
        else if (o === "loss") totals[tid].l++;
      }
    });
    const sorted = Object.values(totals).sort((a, b) => b.pts - a.pts);
    sorted.forEach((t, i) => {
      accum.append(el("div", {
        style: "display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:0.85rem",
      }, [
        el("span", { text: `${i + 1}. ${t.name}` }),
        el("span", { text: `${t.pts}pts (${t.w}V ${t.d}E ${t.l}D)` }),
      ]));
    });
    roundsContainer.append(accum);
  }

  function renderCombatRound(round, results) {
    const card = el("div", { class: "card" });
    card.append(el("div", {
      class: "flex items-center",
      style: "justify-content:space-between;margin-bottom:var(--space-3)",
    }, [
      el("h3", { style: "margin:0", text: round.label || `Ronda ${round.round_number}` }),
      comp.status === "active"
        ? el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
            if (!confirm("¿Eliminar ronda?")) return;
            try { await deleteFieldRound(round.id); rounds = rounds.filter((r) => r.id !== round.id); allResults = allResults.filter((r) => (r.round?.id || r.round_id) !== round.id); renderRounds(); toast("Eliminada", "success"); } catch (err) { toast(err?.message, "error"); }
          }})
        : null,
    ]));

    // Combates registrados en esta ronda
    const fights = [];
    const seen = new Set();
    results.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      const rival = r.meta?.rival_id;
      if (rival && !seen.has(`${tid}:${rival}`) && !seen.has(`${rival}:${tid}`)) {
        seen.add(`${tid}:${rival}`);
        const rivalResult = results.find((x) => (x.team?.id || x.team_id) === rival && x.meta?.rival_id === tid);
        fights.push({ teamA: tid, teamB: rival, resultA: r, resultB: rivalResult });
      }
    });

    fights.forEach((f) => {
      const nameA = teams.find((t) => t.id === f.teamA)?.name || "?";
      const nameB = teams.find((t) => t.id === f.teamB)?.name || "?";
      const outcomeA = f.resultA?.meta?.outcome || "—";
      card.append(el("div", {
        style: "padding:4px 0;border-bottom:1px solid var(--color-border);font-size:0.85rem",
      }, [
        el("span", { text: `${nameA} vs ${nameB} → ${outcomeA === "win" ? nameA + " gana" : outcomeA === "draw" ? "Empate" : nameB + " gana"}` }),
      ]));
    });

    // Formulario para nuevo combate
    if (comp.status === "active") {
      const selA = el("select", { class: "select", style: "width:auto;flex:1" });
      const selB = el("select", { class: "select", style: "width:auto;flex:1" });
      teams.forEach((t) => { selA.append(el("option", { value: t.id, text: t.name })); selB.append(el("option", { value: t.id, text: t.name })); });
      if (teams.length > 1) selB.value = teams[1].id;

      const outcomeSelect = el("select", { class: "select", style: "width:auto" });
      outcomeSelect.append(el("option", { value: "win_a", text: "Gana equipo A" }));
      outcomeSelect.append(el("option", { value: "draw", text: "Empate" }));
      outcomeSelect.append(el("option", { value: "win_b", text: "Gana equipo B" }));

      const saveBtn = el("button", { class: "btn btn--accent btn--sm", text: "Registrar", onclick: async () => {
        const a = selA.value, b = selB.value;
        if (a === b) { toast("Selecciona equipos diferentes", "error"); return; }
        const outcome = outcomeSelect.value;
        let ptsA, ptsB, oA, oB;
        if (outcome === "win_a") { ptsA = winPts; ptsB = lossPts; oA = "win"; oB = "loss"; }
        else if (outcome === "win_b") { ptsA = lossPts; ptsB = winPts; oA = "loss"; oB = "win"; }
        else { ptsA = drawPts; ptsB = drawPts; oA = "draw"; oB = "draw"; }
        try {
          const rA = await upsertFieldResult({ roundId: round.id, teamId: a, rawValue: ptsA, computedPoints: ptsA, meta: { rival_id: b, outcome: oA } });
          const rB = await upsertFieldResult({ roundId: round.id, teamId: b, rawValue: ptsB, computedPoints: ptsB, meta: { rival_id: a, outcome: oB } });
          allResults.push(
            { ...rA, round: { id: round.id }, team: { id: a, name: teams.find((t) => t.id === a)?.name } },
            { ...rB, round: { id: round.id }, team: { id: b, name: teams.find((t) => t.id === b)?.name } }
          );
          renderRounds();
          toast("Combate registrado", "success");
        } catch (err) { toast(err?.message, "error"); }
      }});

      card.append(el("div", { class: "flex gap-2 mt-3", style: "flex-wrap:wrap;align-items:center" }, [
        selA, el("span", { text: "vs" }), selB, outcomeSelect, saveBtn,
      ]));
    }

    return card;
  }

  async function addRound() {
    const nextNum = rounds.length ? Math.max(...rounds.map((r) => r.round_number)) + 1 : 1;
    try { const nr = await createFieldRound({ competitionId: comp.id, roundNumber: nextNum, label: `Ronda ${nextNum}` }); rounds.push(nr); renderRounds(); toast(`Ronda ${nextNum}`, "success"); } catch (err) { toast(err?.message, "error"); }
  }

  renderRounds();
}

/* ──────────────────────────────────────────────────────────────────
   ELIMINATION: rondas progresivas, eliminados conservan puntos
   El juez marca quién sobrevive cada ronda; los eliminados conservan
   los puntos acumulados hasta la última ronda superada.
   ────────────────────────────────────────────────────────────────── */
async function renderElimination(container, comp) {
  const config = comp.config || {};
  const ptsPerRound = config.points_per_round_survived ?? 2;

  let teams, rounds, allResults;
  try {
    [teams, rounds, allResults] = await Promise.all([
      listTeamsByProject(comp.project_id),
      listFieldRounds(comp.id),
      listFieldResultsByCompetition(comp.id),
    ]);
  } catch (err) { container.append(el("div", { class: "error-banner", text: "Error: " + err?.message })); return; }

  container.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: comp.project?.name || "Competencia" }),
        el("p", { class: "text-muted", text: `Eliminación progresiva · ${ptsPerRound}pts/ronda superada · ${teams.length} equipos` }),
      ]),
      comp.status === "active"
        ? el("button", { class: "btn btn--primary", text: "+ Nueva ronda", onclick: addRound })
        : null,
    ])
  );

  const roundsContainer = el("div", { class: "flex-col gap-4" });
  container.append(roundsContainer);

  function getEliminatedBefore(roundNumber) {
    const eliminated = new Set();
    rounds.filter((r) => r.round_number < roundNumber).forEach((prevRound) => {
      allResults
        .filter((r) => (r.round?.id || r.round_id) === prevRound.id && r.meta?.eliminated)
        .forEach((r) => eliminated.add(r.team?.id || r.team_id));
    });
    return eliminated;
  }

  function renderRounds() {
    clear(roundsContainer);
    if (!rounds.length) { roundsContainer.append(el("div", { class: "empty", text: "No hay rondas." })); return; }
    rounds.forEach((round) => {
      const rr = allResults.filter((r) => (r.round?.id || r.round_id) === round.id);
      roundsContainer.append(renderElimRound(round, rr));
    });

    // Ranking acumulado
    const accum = el("div", { class: "card mt-4" });
    accum.append(el("h3", { style: "margin:0 0 var(--space-3)", text: "Ranking acumulado" }));
    const totals = {};
    teams.forEach((t) => { totals[t.id] = { name: t.name, pts: 0, alive: true }; });
    allResults.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      if (totals[tid]) {
        totals[tid].pts += Number(r.computed_points) || 0;
        if (r.meta?.eliminated) totals[tid].alive = false;
      }
    });
    const sorted = Object.values(totals).sort((a, b) => b.pts - a.pts);
    sorted.forEach((t, i) => {
      accum.append(el("div", {
        style: `display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:0.85rem;${!t.alive ? "opacity:0.5;text-decoration:line-through" : ""}`,
      }, [
        el("span", { text: `${i + 1}. ${t.name}` }),
        el("span", { text: `${t.pts}pts${!t.alive ? " (eliminado)" : ""}` }),
      ]));
    });
    roundsContainer.append(accum);
  }

  function renderElimRound(round, results) {
    const eliminatedBefore = getEliminatedBefore(round.round_number);
    const card = el("div", { class: "card" });
    card.append(el("div", {
      class: "flex items-center",
      style: "justify-content:space-between;margin-bottom:var(--space-3)",
    }, [
      el("h3", { style: "margin:0", text: round.label || `Ronda ${round.round_number}` }),
      comp.status === "active"
        ? el("button", { class: "btn btn--danger btn--sm", text: "Eliminar ronda", onclick: async () => {
            if (!confirm("¿Eliminar esta ronda?")) return;
            try { await deleteFieldRound(round.id); rounds = rounds.filter((r) => r.id !== round.id); allResults = allResults.filter((r) => (r.round?.id || r.round_id) !== round.id); renderRounds(); toast("Eliminada", "success"); } catch (err) { toast(err?.message, "error"); }
          }})
        : null,
    ]));

    teams.forEach((team) => {
      if (eliminatedBefore.has(team.id)) return;
      const existing = results.find((r) => (r.team?.id || r.team_id) === team.id);
      const isEliminated = existing?.meta?.eliminated || false;
      const survived = existing && !isEliminated;

      const row = el("div", {
        class: "flex items-center gap-3",
        style: "padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)",
      });
      row.append(el("span", { style: "flex:1;font-weight:500", text: team.name }));

      if (comp.status === "active") {
        const btnSurvive = el("button", {
          class: `btn btn--sm ${survived ? "btn--accent" : "btn--ghost"}`,
          text: "✓ Superó",
          onclick: () => saveResult(round, team, false),
        });
        const btnElim = el("button", {
          class: `btn btn--sm ${isEliminated ? "btn--danger" : "btn--ghost"}`,
          text: "✗ Eliminado",
          onclick: () => saveResult(round, team, true),
        });
        row.append(btnSurvive, btnElim);
      } else {
        row.append(el("span", { class: "badge", text: survived ? `✓ ${ptsPerRound}pts` : isEliminated ? "✗ Eliminado" : "—" }));
      }

      card.append(row);
    });

    return card;
  }

  async function saveResult(round, team, eliminated) {
    const pts = eliminated ? 0 : ptsPerRound;
    try {
      await upsertFieldResult({ roundId: round.id, teamId: team.id, rawValue: eliminated ? 0 : 1, computedPoints: pts, meta: { eliminated } });
      const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === team.id);
      const nr = { round_id: round.id, round: { id: round.id }, team_id: team.id, team: { id: team.id, name: team.name }, raw_value: eliminated ? 0 : 1, computed_points: pts, meta: { eliminated } };
      if (idx >= 0) allResults[idx] = nr; else allResults.push(nr);
      renderRounds();
    } catch (err) { toast(err?.message, "error"); }
  }

  async function addRound() {
    const nextNum = rounds.length ? Math.max(...rounds.map((r) => r.round_number)) + 1 : 1;
    try { const nr = await createFieldRound({ competitionId: comp.id, roundNumber: nextNum, label: `Ronda ${nextNum}` }); rounds.push(nr); renderRounds(); toast(`Ronda ${nextNum}`, "success"); } catch (err) { toast(err?.message, "error"); }
  }

  renderRounds();
}

/* ──────────────────────────────────────────────────────────────────
   TIMED QUANTITY: mover N objetos en menor tiempo, por rondas.
   Similar a time_trial pero con contexto de cantidad y acumulación.
   ────────────────────────────────────────────────────────────────── */
async function renderTimedQuantity(container, comp) {
  const config = comp.config || {};
  const quantity = config.quantity ?? 10;
  const unit = config.unit || "segundos";
  const lowerIsBetter = config.lower_is_better !== false;
  const pointsByPos = config.points_by_position || [5, 3, 2, 1];

  let teams, rounds, allResults;
  try {
    [teams, rounds, allResults] = await Promise.all([
      listTeamsByProject(comp.project_id),
      listFieldRounds(comp.id),
      listFieldResultsByCompetition(comp.id),
    ]);
  } catch (err) { container.append(el("div", { class: "error-banner", text: "Error: " + err?.message })); return; }

  let activeRoundIdx = rounds.length ? rounds.length - 1 : -1;

  container.append(
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: comp.project?.name || "Competencia" }),
        el("p", { class: "text-muted", text: `Cantidad en tiempo · ${quantity} objetos · ${teams.length} equipos` }),
      ]),
      comp.status === "active"
        ? el("button", { class: "btn btn--primary", text: "+ Nueva ronda", onclick: addRound })
        : null,
    ])
  );

  container.append(el("div", { class: "mb-4", style: "font-size:0.83rem;color:var(--color-text-muted)" }, [
    el("strong", { text: "Puntos por posición: " }),
    ...pointsByPos.map((pts, i) => el("span", { text: `${i + 1}°=${pts}pts  ` })),
  ]));

  const tabBar = el("div", { class: "tabs", style: "margin-bottom:var(--space-3);overflow-x:auto" });
  const roundContent = el("div");
  container.append(tabBar, roundContent);

  function renderRounds() {
    clear(tabBar);
    clear(roundContent);

    if (!rounds.length) { roundContent.append(el("div", { class: "empty", text: "No hay rondas." })); return; }

    rounds.forEach((round, idx) => {
      tabBar.append(el("button", {
        class: `tab${idx === activeRoundIdx ? " is-active" : ""}`,
        text: round.label || `Ronda ${round.round_number}`,
        onclick: () => { activeRoundIdx = idx; renderRounds(); },
      }));
    });
    tabBar.append(el("button", {
      class: `tab${activeRoundIdx === -2 ? " is-active" : ""}`,
      style: "font-style:italic",
      text: "Acumulado",
      onclick: () => { activeRoundIdx = -2; renderRounds(); },
    }));

    if (activeRoundIdx === -2) {
      renderAccumulated();
      return;
    }

    const round = rounds[activeRoundIdx] || rounds[rounds.length - 1];
    const rr = allResults.filter((r) => (r.round?.id || r.round_id) === round.id);
    roundContent.append(renderTQRound(round, rr));
  }

  function renderAccumulated() {
    const card = el("div", { class: "card" });
    card.append(el("h3", { style: "margin:0 0 var(--space-3)", text: "Ranking acumulado" }));
    const totals = {};
    teams.forEach((t) => { totals[t.id] = { name: t.name, pts: 0 }; });
    allResults.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      if (totals[tid]) totals[tid].pts += Number(r.computed_points) || 0;
    });
    const sorted = Object.values(totals).sort((a, b) => b.pts - a.pts);
    sorted.forEach((t, i) => {
      card.append(el("div", {
        style: `display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--color-border);font-size:0.9rem;${i < 3 ? "font-weight:600" : ""}`,
      }, [
        el("span", { text: `${i + 1}. ${t.name}` }),
        el("span", { style: "color:var(--color-accent)", text: `${t.pts} pts` }),
      ]));
    });
    roundContent.append(card);
  }

  function renderTQRound(round, results) {
    const card = el("div", { class: "card" });
    card.append(el("div", {
      class: "flex items-center",
      style: "justify-content:space-between;margin-bottom:var(--space-3)",
    }, [
      el("h3", { style: "margin:0", text: round.label || `Ronda ${round.round_number}` }),
      comp.status === "active"
        ? el("button", { class: "btn btn--danger btn--sm", text: "Eliminar", onclick: async () => {
            if (!confirm("¿Eliminar ronda?")) return;
            try { await deleteFieldRound(round.id); rounds = rounds.filter((r) => r.id !== round.id); allResults = allResults.filter((r) => (r.round?.id || r.round_id) !== round.id); activeRoundIdx = Math.max(0, rounds.length - 1); renderRounds(); toast("Eliminada", "success"); } catch (err) { toast(err?.message, "error"); }
          }})
        : null,
    ]));

    const teamsSorted = [...teams].sort((a, b) => {
      const ra = results.find((r) => (r.team?.id || r.team_id) === a.id);
      const rb = results.find((r) => (r.team?.id || r.team_id) === b.id);
      if (!ra && !rb) return 0; if (!ra) return 1; if (!rb) return -1;
      return (rb.computed_points || 0) - (ra.computed_points || 0);
    });

    teamsSorted.forEach((team) => {
      const existing = results.find((r) => (r.team?.id || r.team_id) === team.id);
      const row = el("div", {
        class: "flex items-center gap-3",
        style: "padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)",
      });

      row.append(el("span", { style: "flex:1;font-weight:500", text: team.name }));

      const timeInput = el("input", {
        type: "number", step: "0.01", min: "0", class: "input", style: "width:100px",
        placeholder: unit, value: existing?.raw_value != null ? String(existing.raw_value) : "",
        disabled: comp.status !== "active",
      });
      const ptsEl = el("span", { class: "badge", style: "min-width:50px;text-align:center", text: existing ? `${existing.computed_points}pts` : "—" });

      if (comp.status === "active") {
        timeInput.addEventListener("change", async () => {
          const val = parseFloat(timeInput.value);
          if (isNaN(val) || val < 0) return;
          try {
            const pts = computePositionPoints(round, teams, allResults, team.id, val, pointsByPos, lowerIsBetter);
            await upsertFieldResult({ roundId: round.id, teamId: team.id, rawValue: val, computedPoints: pts, meta: {} });
            const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === team.id);
            const nr = { round_id: round.id, round: { id: round.id }, team_id: team.id, team: { id: team.id, name: team.name }, raw_value: val, computed_points: pts, meta: {} };
            if (idx >= 0) allResults[idx] = nr; else allResults.push(nr);
            await recalcTQRound(round);
            renderRounds();
          } catch (err) { toast(err?.message, "error"); }
        });
      }

      row.append(timeInput, ptsEl);
      card.append(row);
    });

    return card;
  }

  function computePositionPoints(round, teams, allResults, teamId, newVal, pointsByPos, lowerIsBetter) {
    const roundResults = allResults
      .filter((r) => (r.round?.id || r.round_id) === round.id && r.raw_value != null && (r.team?.id || r.team_id) !== teamId)
      .map((r) => ({ teamId: r.team?.id || r.team_id, val: r.raw_value }));
    roundResults.push({ teamId, val: newVal });
    roundResults.sort((a, b) => lowerIsBetter ? a.val - b.val : b.val - a.val);
    let rank = 0;
    for (let i = 0; i < roundResults.length; i++) {
      if (i === 0 || roundResults[i].val !== roundResults[i - 1].val) rank = i;
      if (roundResults[i].teamId === teamId) return pointsByPos[rank] ?? 0;
    }
    return 0;
  }

  async function recalcTQRound(round) {
    const roundResults = allResults.filter((r) => (r.round?.id || r.round_id) === round.id && r.raw_value != null);
    const sorted = [...roundResults].sort((a, b) => lowerIsBetter ? a.raw_value - b.raw_value : b.raw_value - a.raw_value);
    let rank = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i].raw_value !== sorted[i - 1].raw_value) rank = i;
      const pts = pointsByPos[rank] ?? 0;
      if (sorted[i].computed_points !== pts) {
        await upsertFieldResult({ roundId: round.id, teamId: sorted[i].team?.id || sorted[i].team_id, rawValue: sorted[i].raw_value, computedPoints: pts, meta: {} });
        sorted[i].computed_points = pts;
        const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === (sorted[i].team?.id || sorted[i].team_id));
        if (idx >= 0) allResults[idx].computed_points = pts;
      }
    }
  }

  async function addRound() {
    const nextNum = rounds.length ? Math.max(...rounds.map((r) => r.round_number)) + 1 : 1;
    try { const nr = await createFieldRound({ competitionId: comp.id, roundNumber: nextNum, label: `Ronda ${nextNum}` }); rounds.push(nr); activeRoundIdx = rounds.length - 1; renderRounds(); toast(`Ronda ${nextNum}`, "success"); } catch (err) { toast(err?.message, "error"); }
  }

  renderRounds();
}
