import { clear, el, fmtScore, toast } from "../utils.js?v=19";
import { getAuthSnapshot, signInWithPassword, signOut } from "../auth.js?v=19";
import {
  listMyAssignedProjects,
  listTeamsByProject,
  listMyEvaluationsForProjects,
} from "../data.js?v=19";
import { supabase } from "../supabase.js?v=19";

const TYPE_LABELS = {
  time_trial: "Prueba de tiempo",
  performance: "Desempeño con criterios",
  combat: "Combate / Enfrentamiento",
  elimination: "Eliminación progresiva",
  timed_quantity: "Cantidad en tiempo",
};
const STATUS_LABELS = { setup: "En configuración", active: "En curso", finished: "Finalizada" };

export async function renderJury() {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const auth = getAuthSnapshot();
  if (!auth.ready) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Verificando sesión…" }),
    ]));
    return;
  }
  if (!auth.session) return paintLogin(wrap);
  if (!auth.profile) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Cargando perfil…" }),
    ]));
    return;
  }

  if (auth.profile?.role && !["admin", "evaluator"].includes(auth.profile.role)) {
    wrap.append(el("div", { class: "error-banner", text: "Tu cuenta no tiene rol de jurado. Pide al administrador que te asigne." }));
    return;
  }

  wrap.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h1", { text: "Mis proyectos" }),
      el("p", { class: "text-muted", text: `${auth.profile?.display_name || auth.session.user.email}` }),
    ]),
    el("button", { class: "btn btn--ghost", text: "Salir", onclick: async () => { await signOut(); renderJury(); } }),
  ]));

  const list = el("div", { class: "grid grid--cards" });
  wrap.append(list);
  list.append(el("p", { class: "text-muted", text: "Cargando proyectos asignados…" }));

  let projects = [];
  try {
    projects = await listMyAssignedProjects();
  } catch (e) {
    clear(list);
    list.append(el("div", { class: "error-banner", text: "No se pudieron cargar tus proyectos." }));
    return;
  }
  clear(list);
  if (!projects.length) {
    list.append(el("div", { class: "empty", text: "Aún no tienes proyectos asignados." }));
    return;
  }

  // Resumen de mis evaluaciones (por equipo) para construir el progreso de
  // cada proyecto y el promedio personal.
  const projectIds = projects.map((p) => p.id);
  const [myEvals, teamsByProject] = await Promise.all([
    listMyEvaluationsForProjects(projectIds).catch(() => []),
    Promise.all(projectIds.map((pid) => listTeamsByProject(pid).catch(() => [])))
      .then((arr) => Object.fromEntries(arr.map((teams, i) => [projectIds[i], teams]))),
  ]);

  // Aggregamos por proyecto: cantidad de equipos, equipos enviados, equipos
  // en borrador, promedio del jurado (entre los enviados).
  const aggByProject = {};
  projects.forEach((p) => {
    aggByProject[p.id] = {
      teams: teamsByProject[p.id] || [],
      submitted: 0,
      draft: 0,
      submittedScores: [],
    };
  });
  // Agrupamos evaluaciones por (project_id, team_id). Si hay varias fases para
  // un mismo equipo, una sola cuenta como "evaluado" si todas las fases del
  // equipo están enviadas; si alguna queda en borrador o falta, contamos como
  // borrador / pendiente respectivamente.
  const phaseByTeam = {};
  myEvals.forEach((ev) => {
    const key = `${ev.project_id}:${ev.team_id}`;
    if (!phaseByTeam[key]) phaseByTeam[key] = { project_id: ev.project_id, team_id: ev.team_id, evals: [] };
    phaseByTeam[key].evals.push(ev);
  });

  Object.values(phaseByTeam).forEach((bucket) => {
    const agg = aggByProject[bucket.project_id];
    if (!agg) return;
    const allSubmitted = bucket.evals.length > 0 && bucket.evals.every((e) => e.status === "submitted");
    if (allSubmitted) {
      agg.submitted += 1;
      const totals = bucket.evals.map((e) => Number(e.total_score) || 0);
      const sum = totals.reduce((a, b) => a + b, 0);
      // El total que el jurado le dio al equipo = suma de fases (sustentación + concurso, etc.)
      agg.submittedScores.push(sum);
    } else {
      agg.draft += 1;
    }
  });

  projects.forEach((p) => {
    const agg = aggByProject[p.id];
    const totalTeams = agg.teams.length;
    const submitted = agg.submitted;
    const draft = agg.draft;
    const pending = Math.max(0, totalTeams - submitted - draft);
    const avg = agg.submittedScores.length
      ? agg.submittedScores.reduce((a, b) => a + b, 0) / agg.submittedScores.length
      : null;

    const progressPct = totalTeams ? Math.round((submitted / totalTeams) * 100) : 0;

    const progressBar = el("div", { class: "jury-progress__track" }, [
      el("div", { class: "jury-progress__fill", style: { width: `${progressPct}%` } }),
    ]);

    const badges = el("div", { class: "jury-progress__badges" }, [
      el("span", { class: "pill pill--accent", text: `${submitted} enviados` }),
      draft ? el("span", { class: "pill pill--warning", text: `${draft} borrador` }) : null,
      pending ? el("span", { class: "pill", text: `${pending} pendientes` }) : null,
    ].filter(Boolean));

    list.append(el("a", {
      class: "project-card",
      href: `#/jurado/proyecto/${p.id}`,
    }, [
      el("div", { class: "project-card__cover project-card__cover--placeholder" }),
      el("div", { class: "project-card__title", text: p.name }),
      el("div", { class: "project-card__meta", text: [p.grade_label, p.room].filter(Boolean).join(" · ") || "—" }),
      el("div", { class: "jury-progress" }, [
        el("div", { class: "jury-progress__head" }, [
          el("span", { class: "text-muted", text: `${submitted}/${totalTeams} equipos evaluados` }),
          el("span", { class: "text-strong", text: avg != null ? `Promedio personal: ${fmtScore(avg)}` : "Sin envíos aún" }),
        ]),
        progressBar,
        badges,
      ]),
      el("div", { class: "btn btn--primary btn--sm", text: "Evaluar →" }),
    ]));
  });

  // ── Competencias de campo asignadas al juez (multi-juez) ──────────
  try {
    // Buscar mis asignaciones en la tabla intermedia
    const { data: myEvaluator } = await supabase
      .from("evaluators")
      .select("id")
      .eq("user_id", auth.session.user.id)
      .maybeSingle();

    if (myEvaluator) {
      const { data: myAssignments } = await supabase
        .from("field_competition_judges")
        .select("competition_id")
        .eq("evaluator_id", myEvaluator.id);

      if (myAssignments?.length) {
        const compIds = myAssignments.map((a) => a.competition_id);
        const { data: myFieldComps } = await supabase
          .from("field_competitions")
          .select("id, competition_type, status, project:projects(name)")
          .in("id", compIds)
          .in("status", ["active", "finished"]);

        if (myFieldComps?.length) {
          wrap.append(el("div", { class: "section-head mt-6" }, [
            el("h2", { text: "🏁 Pruebas de campo" }),
            el("p", { class: "text-muted", text: "Competencias con registro manual de tiempos/resultados" }),
          ]));
          const fieldList = el("div", { class: "grid grid--cards" });
          wrap.append(fieldList);
          myFieldComps.forEach((fc) => {
            fieldList.append(el("a", {
              class: "project-card",
              href: `#/campo/${fc.id}`,
              style: "border:2px solid var(--color-accent);background:linear-gradient(135deg, rgba(34,197,94,0.08) 0%, transparent 60%)",
            }, [
              el("div", {
                style: "padding:var(--space-3);text-align:center;font-size:2rem;background:rgba(34,197,94,0.12);border-radius:var(--radius-md)",
                text: "🏁",
              }),
              el("div", { class: "project-card__title", text: fc.project?.name || "Competencia" }),
              el("div", { class: "project-card__meta", style: "color:var(--color-accent)", text: `${TYPE_LABELS[fc.competition_type] || fc.competition_type} · ${STATUS_LABELS[fc.status]}` }),
              el("div", { class: `btn btn--sm ${fc.status === "active" ? "btn--accent" : "btn--ghost"}`, text: fc.status === "active" ? "🏁 Registrar →" : "Ver resultados →" }),
            ]));
          });
        }
      }
    }
  } catch { /* silencioso */ }
}

function paintLogin(root) {
  const emailEl = el("input", { class: "input", type: "email", required: true, autocomplete: "username", placeholder: "tu@correo.com" });
  const passEl = el("input", { class: "input", type: "password", required: true, autocomplete: "current-password", placeholder: "••••••••" });
  const errBox = el("div", { class: "field__error" });

  const form = el("form", { class: "card auth-shell", onsubmit: async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      await signInWithPassword(emailEl.value.trim(), passEl.value);
      renderJury();
    } catch (err) {
      errBox.textContent = err?.message || "No se pudo iniciar sesión";
    } finally {
      if (btn) btn.disabled = false;
    }
  }}, [
    el("h1", { text: "Acceso jurado" }),
    el("p", { class: "text-muted mb-3", text: "Inicia sesión con el correo y la contraseña que te envió el administrador." }),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Correo" }), emailEl]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Contraseña" }), passEl]),
    errBox,
    el("button", { class: "btn btn--primary btn--lg btn--block", type: "submit", text: "Entrar" }),
    el("p", { class: "text-soft mt-3", style: { fontSize: "0.8rem", textAlign: "center" }, text: "¿No te llegaron tus credenciales? Pídele al administrador que cree tu cuenta." }),
  ]);
  root.append(form);
}
