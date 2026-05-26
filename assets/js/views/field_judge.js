import { el, clear, toast } from "../utils.js?v=19";
import { supabase } from "../supabase.js?v=19";
import { getAuthSnapshot } from "../auth.js?v=19";
import {
  getFieldCompetition, listFieldRounds, listFieldResults,
  createFieldRound, deleteFieldRound, upsertFieldResult, deleteFieldResult,
  listFieldResultsByCompetition,
} from "../data.js?v=19";
import { listTeamsByProject } from "../data.js?v=19";

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

  // Container de rondas
  const roundsContainer = el("div", { class: "flex-col gap-4" });
  container.append(roundsContainer);

  function renderRounds() {
    clear(roundsContainer);
    if (!rounds.length) {
      roundsContainer.append(el("div", { class: "empty", text: "No hay rondas. Agrega una para comenzar." }));
      return;
    }
    rounds.forEach((round) => {
      const roundResults = allResults.filter((r) => r.round?.id === round.id || r.round_id === round.id);
      roundsContainer.append(renderRoundCard(round, roundResults));
    });
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
                renderRounds();
                toast("Ronda eliminada", "success");
              } catch (err) { toast("Error: " + err?.message, "error"); }
            },
          })
        : null,
    ]));

    // Formulario de tiempos
    const table = el("div", { class: "responsive-table" });
    const tbody = el("div", { class: "flex-col gap-2" });
    table.append(tbody);

    teams.forEach((team) => {
      const existing = results.find((r) => (r.team?.id || r.team_id) === team.id);
      const row = el("div", {
        class: "flex items-center gap-3",
        style: "padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)",
      });

      const nameEl = el("span", { style: "flex:1;font-weight:500", text: team.name });
      const timeInput = el("input", {
        type: "number",
        step: "0.01",
        min: "0",
        class: "input",
        style: "width:100px",
        placeholder: unit,
        value: existing?.raw_value != null ? String(existing.raw_value) : "",
      });
      const ptsEl = el("span", {
        class: "badge",
        style: "min-width:50px;text-align:center",
        text: existing ? `${existing.computed_points} pts` : "—",
      });

      if (comp.status === "active") {
        timeInput.addEventListener("change", async () => {
          const val = parseFloat(timeInput.value);
          if (isNaN(val) || val < 0) return;
          try {
            const pts = computeTimeTrialPoints(round, teams, allResults, team.id, val, positions, lowerIsBetter);
            await upsertFieldResult({ roundId: round.id, teamId: team.id, rawValue: val, computedPoints: pts, meta: {} });
            // Refresh local
            const idx = allResults.findIndex((r) => (r.round?.id || r.round_id) === round.id && (r.team?.id || r.team_id) === team.id);
            const newResult = { round_id: round.id, round: { id: round.id }, team_id: team.id, team: { id: team.id, name: team.name }, raw_value: val, computed_points: pts };
            if (idx >= 0) allResults[idx] = newResult; else allResults.push(newResult);
            // Recalcular puntos de toda la ronda
            await recalcRound(round);
            renderRounds();
          } catch (err) { toast("Error: " + err?.message, "error"); }
        });
      } else {
        timeInput.disabled = true;
      }

      row.append(nameEl, timeInput, ptsEl);
      tbody.append(row);
    });

    card.append(table);

    // Ranking de la ronda
    const sorted = [...results].filter((r) => r.raw_value != null).sort((a, b) =>
      lowerIsBetter ? a.raw_value - b.raw_value : b.raw_value - a.raw_value
    );
    if (sorted.length) {
      const rankList = el("div", { style: "margin-top:var(--space-3);font-size:0.85rem" });
      rankList.append(el("strong", { text: "Ranking: " }));
      sorted.forEach((r, i) => {
        const name = r.team?.name || "Equipo";
        rankList.append(el("span", { text: `${i + 1}° ${name} (${r.raw_value}${unit}) ` }));
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
      renderRounds();
      toast(`Ronda ${nextNum} creada`, "success");
    } catch (err) { toast("Error: " + err?.message, "error"); }
  }

  async function recalcRound(round) {
    const roundResults = allResults.filter((r) => (r.round?.id || r.round_id) === round.id && r.raw_value != null);
    const sorted = [...roundResults].sort((a, b) =>
      lowerIsBetter ? a.raw_value - b.raw_value : b.raw_value - a.raw_value
    );
    for (let i = 0; i < sorted.length; i++) {
      const posConfig = positions.find((p) => p.place === i + 1);
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
    const pos = roundResults.findIndex((r) => r.teamId === teamId) + 1;
    const posConfig = positions.find((p) => p.place === pos);
    return posConfig ? posConfig.points : 0;
  }

  renderRounds();
}

/* ──────────────────────────────────────────────────────────────────
   PERFORMANCE: puntos acumulables por eventos/criterios
   (Stub - se implementará en E5)
   ────────────────────────────────────────────────────────────────── */
async function renderPerformance(container, comp) {
  container.append(el("div", { class: "empty", text: "Strategy 'performance' próximamente (E5)." }));
}

/* ──────────────────────────────────────────────────────────────────
   COMBAT: victoria/empate/derrota entre pares
   (Stub - se implementará en E5)
   ────────────────────────────────────────────────────────────────── */
async function renderCombat(container, comp) {
  container.append(el("div", { class: "empty", text: "Strategy 'combat' próximamente (E5)." }));
}

/* ──────────────────────────────────────────────────────────────────
   ELIMINATION: rondas progresivas, eliminados conservan puntos
   (Stub - se implementará en E6)
   ────────────────────────────────────────────────────────────────── */
async function renderElimination(container, comp) {
  container.append(el("div", { class: "empty", text: "Strategy 'elimination' próximamente (E6)." }));
}

/* ──────────────────────────────────────────────────────────────────
   TIMED QUANTITY: mover N objetos en menor tiempo
   (Stub - se implementará en E6)
   ────────────────────────────────────────────────────────────────── */
async function renderTimedQuantity(container, comp) {
  container.append(el("div", { class: "empty", text: "Strategy 'timed_quantity' próximamente (E6)." }));
}
