import { clear, el, escapeHTML } from "../utils.js";
import { getCurrentEdition } from "../state.js";
import { listProjects } from "../data.js";

export async function renderProjects() {
  const main = document.querySelector("[data-app-main]");
  clear(main);

  const edition = getCurrentEdition();
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const head = el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h1", { text: "Proyectos" }),
      el("p", {
        class: "text-muted",
        text: edition ? `Edición ${edition.year} · ${edition.name}` : "Selecciona una edición disponible.",
      }),
    ]),
    el("input", {
      class: "input",
      placeholder: "Buscar por nombre o grado…",
      style: { maxWidth: "320px" },
      oninput: (e) => filter(e.target.value),
    }),
  ]);

  const grid = el("div", { class: "grid grid--cards" });
  wrap.append(head, grid);

  if (!edition) {
    grid.append(el("div", { class: "empty", text: "Aún no hay edición activa." }));
    return;
  }

  let all = [];
  try {
    all = await listProjects(edition.id);
  } catch (err) {
    grid.append(el("div", { class: "error-banner", text: "No se pudieron cargar los proyectos." }));
    return;
  }
  paint(all);

  function paint(list) {
    clear(grid);
    if (!list.length) {
      grid.append(el("div", { class: "empty", text: "No hay proyectos publicados todavía." }));
      return;
    }
    list.forEach((p) => grid.append(projectCard(p)));
  }
  function filter(q) {
    const t = (q || "").trim().toLowerCase();
    if (!t) return paint(all);
    paint(all.filter((p) =>
      [p.name, p.grade_label, p.room, p.description].filter(Boolean).join(" ").toLowerCase().includes(t)
    ));
  }
}

function projectCard(p) {
  return el("a", {
    class: "project-card",
    href: `#/proyectos/${p.id}`,
  }, [
    el("div", { class: "project-card__cover project-card__cover--placeholder" }),
    el("div", { class: "project-card__title", text: p.name }),
    el("div", { class: "project-card__meta", text: [
      p.grade_label && `Grado: ${p.grade_label}`,
      p.room && `Aula: ${p.room}`,
      p.presentation_order && `Orden: ${p.presentation_order}`,
    ].filter(Boolean).join(" · ") || "—" }),
    p.description ? el("p", { class: "text-muted", text: truncate(p.description, 110) }) : null,
  ]);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
