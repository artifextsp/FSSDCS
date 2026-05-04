import { clear, el, fmtScore } from "../utils.js";
import { getProjectFull, listProjectRanking, signedDocUrl, signedPhotoUrl } from "../data.js";
import { subscribeTable } from "../realtime.js";

export async function renderProject(id) {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);
  wrap.append(el("p", { class: "text-muted", text: "Cargando proyecto…" }));

  let payload, ranking;
  try {
    payload = await getProjectFull(id);
    ranking = await listProjectRanking(id);
  } catch (e) {
    clear(wrap);
    wrap.append(el("div", { class: "error-banner", text: "No se pudo cargar el proyecto." }));
    return;
  }
  if (!payload?.project) {
    clear(wrap);
    wrap.append(el("div", { class: "empty", text: "Proyecto no encontrado." }));
    return;
  }

  const { project, teams, docs, configs } = payload;
  clear(wrap);

  wrap.append(el("a", { class: "btn btn--ghost btn--sm", href: "#/proyectos", text: "← Volver a proyectos" }));
  wrap.append(el("div", { class: "section-head", style: { marginTop: "var(--space-3)" } }, [
    el("div", {}, [
      el("h1", { text: project.name }),
      el("p", { class: "text-muted", text: [
        project.grade_label && `Grado ${project.grade_label}`,
        `${teams.length} equipo(s) en competencia`,
      ].filter(Boolean).join(" · ") || "—" }),
    ]),
  ]));

  const body = el("div", { class: "grid", style: { gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "var(--space-5)" } });
  wrap.append(body);

  const left = el("div", { class: "flex-col gap-4" });
  const right = el("div", { class: "flex-col gap-4" });
  body.append(left, right);

  if (project.description) {
    left.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Descripción" }),
      el("p", { class: "text-muted", text: project.description }),
    ]));
  }

  const teamsCard = el("div", { class: "card" }, [
    el("h3", { class: "card__title", text: "Equipos" }),
    el("p", { class: "text-muted", style: { fontSize: "0.85rem" }, text: "Cada equipo se evalúa por separado y compite dentro del proyecto." }),
  ]);
  left.append(teamsCard);

  if (!teams.length) {
    teamsCard.append(el("div", { class: "empty", text: "Aún no hay equipos." }));
  } else {
    const rankByTeam = Object.fromEntries((ranking || []).map((r) => [r.team_id, r]));
    const list = el("div", { class: "flex-col gap-2 mt-3" });
    teams.forEach((t) => {
      const r = rankByTeam[t.id] || {};
      list.append(el("a", { class: "rank-row", href: `#/equipos/${t.id}`, style: { textDecoration: "none", color: "inherit" } }, [
        el("div", { class: `rank-row__pos rank-row__pos--${r.project_rank <= 3 ? r.project_rank : ""}`, text: r.project_rank ? String(r.project_rank) : "—" }),
        el("div", {}, [
          el("div", { class: "rank-row__title", text: t.name }),
          el("div", { class: "rank-row__meta", text: [
            t.room && `Aula ${t.room}`,
            t.presentation_order != null && `Orden ${t.presentation_order}`,
            r.sustentation_avg != null && `Sustentación ${fmtScore(r.sustentation_avg)}`,
            r.field_contest_avg != null && `Concurso ${fmtScore(r.field_contest_avg)}`,
          ].filter(Boolean).join(" · ") }),
        ]),
        el("div", { class: "rank-row__score" }, [
          `${fmtScore(r.total_score ?? 0)}`,
          el("small", { text: "Total" }),
        ]),
      ]));
    });
    teamsCard.append(list);
  }

  if (configs?.length) {
    const cfgCard = el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Metodología de evaluación" }),
    ]);
    configs.forEach((c) => {
      cfgCard.append(el("div", { class: "muted-card mt-3" }, [
        el("div", { class: "flex items-center gap-2" }, [
          el("span", { class: "pill pill--primary", text: phaseLabel(c.phase) }),
          el("span", { class: "pill", text: methodLabel(c.method_type) }),
          el("span", { class: "text-muted", text: `Escala: ${c.scale_min}–${c.scale_max}` }),
        ]),
      ]));
    });
    right.append(cfgCard);
  }

  if (docs?.length) {
    const list = el("div", { class: "flex-col gap-2" });
    for (const d of docs) {
      const url = await signedDocUrl(d.storage_path).catch(() => null);
      list.append(el("a", { class: "btn btn--ghost", href: url || "#", target: "_blank", rel: "noopener", text: `📄 ${d.title}` }));
    }
    right.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Documentos" }), list,
    ]));
  }

  const unsub = subscribeTable({
    table: "team_score_cache",
    filter: `project_id=eq.${project.id}`,
    onChange: async () => {
      try {
        const fresh = await listProjectRanking(project.id);
        const map = Object.fromEntries(fresh.map((r) => [r.team_id, r]));
        teamsCard.querySelectorAll(".rank-row").forEach((row) => {
          const href = row.getAttribute("href") || "";
          const tId = href.split("/").pop();
          const r = map[tId];
          if (!r) return;
          const pos = row.querySelector(".rank-row__pos");
          const score = row.querySelector(".rank-row__score");
          if (pos) pos.textContent = r.project_rank ? String(r.project_rank) : "—";
          if (score) {
            const small = el("small", { text: "Total" });
            score.textContent = `${fmtScore(r.total_score)}`;
            score.append(small);
          }
        });
      } catch {}
    },
  });

  return { cleanup: () => unsub?.() };
}

function phaseLabel(p) { return p === "sustentation" ? "Sustentación" : p === "field_contest" ? "Concurso de campo" : p; }
function methodLabel(m) {
  return ({
    questionnaire: "Cuestionario", interview: "Entrevista",
    questionnaire_interview: "Cuestionario + Entrevista",
    process_phases: "Fases del proceso",
    process_phases_interview: "Fases + Entrevista",
    field_rounds: "Rondas de concurso",
  })[m] || m;
}
