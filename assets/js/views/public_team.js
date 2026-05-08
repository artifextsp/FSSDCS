import { clear, el, fmtScore } from "../utils.js?v=18";
import { getTeamFull, signedPhotoUrl } from "../data.js?v=18";
import { subscribeTable } from "../realtime.js?v=18";

export async function renderPublicTeam(teamId) {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);
  wrap.append(el("p", { class: "text-muted", text: "Cargando equipo…" }));

  let bundle;
  try { bundle = await getTeamFull(teamId); }
  catch (e) {
    clear(wrap);
    wrap.append(el("div", { class: "error-banner", text: "No se pudo cargar el equipo." }));
    return;
  }
  if (!bundle?.team) { clear(wrap); wrap.append(el("div", { class: "empty", text: "Equipo no encontrado." })); return; }

  const { team, project, members, photos, score } = bundle;
  clear(wrap);
  wrap.append(el("a", { class: "btn btn--ghost btn--sm", href: `#/proyectos/${project.id}`, text: `← ${project.name}` }));

  const head = el("div", { class: "section-head", style: { marginTop: "var(--space-3)" } }, [
    el("div", {}, [
      el("h1", { text: team.name }),
      el("p", { class: "text-muted", text: [
        project.name,
        team.room && `Aula ${team.room}`,
        team.presentation_order != null && `Orden ${team.presentation_order}`,
      ].filter(Boolean).join(" · ") || "—" }),
    ]),
    el("div", { class: "tag-list" }, [
      el("span", { class: "pill pill--primary", text: `Sustentación: ${fmtScore(score?.sustentation_avg ?? 0)}` }),
      el("span", { class: "pill pill--primary", text: `Concurso: ${fmtScore(score?.field_contest_avg ?? 0)}` }),
      el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(score?.total_score ?? 0)}` }),
    ]),
  ]);
  wrap.append(head);

  const carousel = el("div", { class: "carousel mb-4" });
  const track = el("div", { class: "carousel__track" });
  const dots = el("div", { class: "carousel__dots" });
  const prev = el("button", { class: "carousel__nav carousel__nav--prev", text: "‹", onclick: () => scroll(-1) });
  const next = el("button", { class: "carousel__nav carousel__nav--next", text: "›", onclick: () => scroll(1) });
  carousel.append(track, prev, next, dots);
  wrap.append(carousel);

  await renderPhotos(track, dots, photos);
  function scroll(dir) { track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" }); }
  track.addEventListener("scroll", () => updateDots(track, dots));

  const grid = el("div", { class: "grid", style: { gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "var(--space-5)" } });
  wrap.append(grid);
  const left = el("div", { class: "flex-col gap-4" });
  const right = el("div", { class: "flex-col gap-4" });
  grid.append(left, right);

  const memCard = el("div", { class: "card" }, [el("h3", { class: "card__title", text: "Integrantes" })]);
  if (members?.length) {
    const ul = el("ul", { style: { margin: 0, padding: 0, listStyle: "none" }, class: "flex-col gap-2" });
    members.forEach((m) => ul.append(el("li", { class: "muted-card", text: m.full_name })));
    memCard.append(ul);
  } else memCard.append(el("p", { class: "text-muted", text: "Sin integrantes registrados." }));
  left.append(memCard);

  if (team.description) {
    left.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Acerca del equipo" }),
      el("p", { class: "text-muted", text: team.description }),
    ]));
  }

  const unsubPhotos = subscribeTable({
    table: "team_photos",
    filter: `team_id=eq.${team.id}`,
    onChange: async () => {
      try { const fresh = await getTeamFull(team.id); await renderPhotos(track, dots, fresh.photos || []); }
      catch {}
    },
  });

  const unsubScore = subscribeTable({
    table: "team_score_cache",
    filter: `team_id=eq.${team.id}`,
    onChange: async () => {
      try {
        const fresh = await getTeamFull(team.id);
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

  return { cleanup: () => { unsubPhotos?.(); unsubScore?.(); } };
}

async function renderPhotos(track, dots, photos) {
  clear(track); clear(dots);
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
    if (url) slide.append(el("img", { src: url, alt: p.caption || "Foto del equipo", loading: "lazy" }));
    track.append(slide);
    dots.append(el("span", { class: `carousel__dot ${i === 0 ? "is-active" : ""}` }));
  }
}
function updateDots(track, dots) {
  const w = track.clientWidth; if (!w) return;
  const idx = Math.round(track.scrollLeft / w);
  Array.from(dots.children).forEach((d, i) => d.classList.toggle("is-active", i === idx));
}
