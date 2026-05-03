import { clear, el, fmtScore } from "../utils.js";
import { getProjectFull, signedPhotoUrl, signedDocUrl } from "../data.js";
import { subscribeTable } from "../realtime.js";

export async function renderProject(id) {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);
  wrap.append(el("p", { class: "text-muted", text: "Cargando proyecto…" }));

  let payload;
  try {
    payload = await getProjectFull(id);
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

  const { project, team, members, photos, docs, configs, score } = payload;
  clear(wrap);

  // Header
  wrap.append(
    el("a", { class: "btn btn--ghost btn--sm", href: "#/proyectos", text: "← Volver a proyectos" })
  );
  const head = el("div", { class: "section-head", style: { marginTop: "var(--space-3)" } }, [
    el("div", {}, [
      el("h1", { text: project.name }),
      el("p", { class: "text-muted", text: [
        project.grade_label && `Grado ${project.grade_label}`,
        project.room && `Aula ${project.room}`,
        project.presentation_order && `Orden ${project.presentation_order}`,
      ].filter(Boolean).join(" · ") || "—" }),
    ]),
    el("div", { class: "tag-list" }, [
      el("span", { class: "pill pill--primary", text: `Sustentación: ${fmtScore(score?.sustentation_avg)}` }),
      el("span", { class: "pill pill--primary", text: `Concurso: ${fmtScore(score?.field_contest_avg)}` }),
      el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(score?.total_score)}` }),
    ]),
  ]);
  wrap.append(head);

  // Carousel
  const carousel = el("div", { class: "carousel mb-4" });
  const track = el("div", { class: "carousel__track" });
  const dots = el("div", { class: "carousel__dots" });
  const prev = el("button", { class: "carousel__nav carousel__nav--prev", text: "‹", onclick: () => scroll(-1) });
  const next = el("button", { class: "carousel__nav carousel__nav--next", text: "›", onclick: () => scroll(1) });
  carousel.append(track, prev, next, dots);
  wrap.append(carousel);

  await renderPhotos(track, dots, photos);
  function scroll(dir) {
    const w = track.clientWidth;
    track.scrollBy({ left: dir * w, behavior: "smooth" });
  }
  track.addEventListener("scroll", () => updateDots(track, dots));

  // Body
  const body = el("div", { class: "grid", style: { gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "var(--space-5)" } });
  wrap.append(body);

  const left = el("div", { class: "flex-col gap-4" });
  const right = el("div", { class: "flex-col gap-4" });
  body.append(left, right);

  // Description
  if (project.description) {
    left.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Descripción" }),
      el("p", { class: "text-muted", text: project.description }),
    ]));
  }

  // Configs preview
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
    left.append(cfgCard);
  }

  // Documents
  if (docs?.length) {
    const list = el("div", { class: "flex-col gap-2" });
    for (const d of docs) {
      const url = await signedDocUrl(d.storage_path).catch(() => null);
      list.append(el("a", {
        class: "btn btn--ghost",
        href: url || "#",
        target: "_blank",
        rel: "noopener",
        text: `📄 ${d.title}`,
      }));
    }
    left.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Documentos" }),
      list,
    ]));
  }

  // Team / Members
  if (team || members?.length) {
    const list = el("ul", { class: "flex-col gap-2", style: { listStyle: "none", padding: 0, margin: 0 } });
    members.forEach((m) => list.append(el("li", { class: "muted-card", text: m.full_name })));
    right.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Equipo" }),
      team ? el("p", { class: "text-muted", text: team.name }) : null,
      members?.length ? list : el("p", { class: "text-muted", text: "Sin integrantes registrados." }),
    ]));
  }

  // Subscribe to score updates
  const unsub = subscribeTable({
    table: "project_score_cache",
    filter: `project_id=eq.${project.id}`,
    onChange: async () => {
      try {
        const fresh = await getProjectFull(id);
        const s = fresh?.score;
        const pills = head.querySelectorAll(".tag-list .pill");
        if (pills?.length === 3 && s) {
          pills[0].textContent = `Sustentación: ${fmtScore(s.sustentation_avg)}`;
          pills[1].textContent = `Concurso: ${fmtScore(s.field_contest_avg)}`;
          pills[2].textContent = `Total: ${fmtScore(s.total_score)}`;
        }
      } catch {}
    },
  });
  const unsubPhotos = subscribeTable({
    table: "project_photos",
    filter: `project_id=eq.${project.id}`,
    onChange: async () => {
      try {
        const fresh = await getProjectFull(id);
        await renderPhotos(track, dots, fresh.photos || []);
      } catch {}
    },
  });

  return { cleanup: () => { unsub?.(); unsubPhotos?.(); } };
}

async function renderPhotos(track, dots, photos) {
  clear(track);
  clear(dots);
  if (!photos?.length) {
    track.append(el("div", { class: "carousel__slide" }, [
      el("div", { style: { display: "grid", placeItems: "center", color: "rgba(255,255,255,.5)", height: "100%" }, text: "Sin fotografías por ahora" }),
    ]));
    return;
  }
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const url = await signedPhotoUrl(p.storage_path).catch(() => null);
    const slide = el("div", { class: "carousel__slide" });
    if (url) slide.append(el("img", { src: url, alt: p.caption || "Fotografía del proyecto", loading: "lazy" }));
    track.append(slide);
    dots.append(el("span", { class: `carousel__dot ${i === 0 ? "is-active" : ""}` }));
  }
}

function updateDots(track, dots) {
  const w = track.clientWidth;
  if (!w) return;
  const idx = Math.round(track.scrollLeft / w);
  Array.from(dots.children).forEach((d, i) => d.classList.toggle("is-active", i === idx));
}

function phaseLabel(p) {
  return p === "sustentation" ? "Sustentación" : p === "field_contest" ? "Concurso de campo" : p;
}
function methodLabel(m) {
  return ({
    questionnaire: "Cuestionario",
    interview: "Entrevista",
    questionnaire_interview: "Cuestionario + Entrevista",
    process_phases: "Fases del proceso",
    process_phases_interview: "Fases + Entrevista",
    field_rounds: "Rondas de concurso",
  })[m] || m;
}
