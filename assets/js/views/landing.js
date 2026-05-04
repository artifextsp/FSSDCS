import { el, clear, fmtScore } from "../utils.js?v=14";
import { getCurrentEdition } from "../state.js?v=14";
import { listProjects, listRanking } from "../data.js?v=14";
import { subscribeTable } from "../realtime.js?v=14";

export async function renderLanding() {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const edition = getCurrentEdition();

  const heroActions = el("div", { class: "hero__actions" }, [
    el("a", { class: "btn btn--primary btn--lg", href: "#/proyectos", text: "Explorar proyectos" }),
    el("a", { class: "btn btn--ghost btn--lg", href: "#/ranking", text: "Ver ranking" }),
    el("a", { class: "btn btn--accent btn--lg", href: "#/equipo", text: "Soy de un equipo" }),
  ]);

  const editionPill = edition
    ? el("span", { class: "pill pill--accent", text: `Edición ${edition.year} · ${edition.name}` })
    : el("span", { class: "pill pill--warning", text: "Aún no hay edición activa" });

  const projectsCountEl = el("div", { class: "metric__value", text: "—" });
  const teamsCountEl = el("div", { class: "metric__value", text: "—" });
  const topScoreEl = el("div", { class: "metric__value", text: "—" });

  const featured = el("div", { class: "grid grid--cards" });

  const hero = el("section", { class: "hero" }, [
    el("div", { class: "container" }, [
      editionPill,
      el("h1", { class: "hero__title", text: "La feria STEAM oficial, en vivo." }),
      el("p", { class: "hero__lead", text: "Sustentaciones, concursos, fotografías y rankings de la Feria del Seminario Diocesano Cristo Sacerdote, en una sola plataforma diseñada para celular." }),
      heroActions,
    ]),
  ]);

  const stats = el("section", { class: "container", style: { marginTop: "var(--space-7)" } }, [
    el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" } }, [
      el("div", { class: "card metric" }, [el("div", { class: "metric__label", text: "Proyectos" }), projectsCountEl]),
      el("div", { class: "card metric" }, [el("div", { class: "metric__label", text: "Equipos" }), teamsCountEl]),
      el("div", { class: "card metric" }, [el("div", { class: "metric__label", text: "Puntaje top" }), topScoreEl]),
    ]),
  ]);

  const featuredSection = el("section", { class: "container", style: { marginTop: "var(--space-8)" } }, [
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("h2", { text: "Proyectos destacados" }),
        el("p", { text: "Una muestra de la edición vigente." }),
      ]),
      el("a", { class: "btn btn--ghost btn--sm", href: "#/proyectos", text: "Ver todos →" }),
    ]),
    featured,
  ]);

  const aboutSection = el("section", { class: "container", style: { marginTop: "var(--space-8)" } }, [
    el("div", { class: "card card--pad-lg" }, [
      el("h2", { text: "Cómo funciona" }),
      el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" } }, [
        el("div", {}, [el("h4", { text: "Múltiples equipos por proyecto" }), el("p", { class: "text-muted", text: "Un mismo proyecto puede tener varios equipos compitiendo entre ellos. Cada equipo se evalúa por separado." })]),
        el("div", {}, [el("h4", { text: "Sustentaciones" }), el("p", { class: "text-muted", text: "Cuestionarios, entrevistas o evaluación por fases. Cada proyecto se configura a la medida." })]),
        el("div", {}, [el("h4", { text: "Concurso de campo" }), el("p", { class: "text-muted", text: "Rondas y modalidades flexibles. Las pruebas suman al ranking final." })]),
        el("div", {}, [el("h4", { text: "Ranking instantáneo" }), el("p", { class: "text-muted", text: "Los puntajes se sincronizan en tiempo real para toda la comunidad." })]),
      ]),
    ]),
  ]);

  main.append(hero, stats, featuredSection, aboutSection);

  if (!edition) return;

  try {
    const [projects, ranking] = await Promise.all([
      listProjects(edition.id),
      listRanking(edition.id),
    ]);
    projectsCountEl.textContent = String(projects.length);
    teamsCountEl.textContent = String(ranking.length);
    topScoreEl.textContent = ranking[0] ? fmtScore(ranking[0].total_score) : "—";

    clear(featured);
    const cards = projects.slice(0, 6).map((p) => projectCard(p));
    if (!cards.length) featured.append(el("div", { class: "empty", text: "Aún no hay proyectos publicados." }));
    else cards.forEach((c) => featured.append(c));
  } catch (err) { console.warn(err); }

  const unsub = subscribeTable({
    table: "team_score_cache",
    filter: `edition_id=eq.${edition.id}`,
    onChange: async () => {
      const r = await listRanking(edition.id).catch(() => []);
      teamsCountEl.textContent = String(r.length);
      topScoreEl.textContent = r[0] ? fmtScore(r[0].total_score) : "—";
    },
  });

  return { cleanup: () => unsub?.() };
}

function projectCard(p) {
  return el("a", { class: "project-card", href: `#/proyectos/${p.id}` }, [
    el("div", { class: "project-card__cover project-card__cover--placeholder" }),
    el("div", { class: "project-card__title", text: p.name }),
    el("div", { class: "project-card__meta", text: p.grade_label ? `Grado ${p.grade_label}` : "—" }),
  ]);
}
