import { clear, el, fmtScore, toast } from "../utils.js?v=19";
import { listEditionsAccessible, teamPortalLookup, searchTeamsByName, signedPhotoUrl, resolveDocUrl } from "../data.js?v=19";
import { getCurrentEdition, setCurrentEdition } from "../state.js?v=19";

export async function renderTeam() {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  wrap.append(el("h1", { text: "Mi equipo" }));
  wrap.append(el("p", { class: "text-muted", text: "Escribe parte del nombre de tu equipo para buscarlo." }));

  const editions = await listEditionsAccessible().catch(() => []);
  const stored = getCurrentEdition();
  const slugSelect = el("select", { class: "select", required: true });
  if (!editions.length) slugSelect.append(el("option", { value: "", text: "Sin ediciones disponibles" }));
  else {
    editions.forEach((e) => slugSelect.append(el("option", { value: e.slug, text: `${e.year} · ${e.name}` })));
    if (stored?.slug) slugSelect.value = stored.slug;
  }

  const nameInput = el("input", {
    class: "input",
    placeholder: "Escribe parte del nombre (ej: robot, los, aste…)",
    required: true,
    autocomplete: "off",
  });
  const suggestions = el("div", { class: "team-suggestions" });
  const result = el("div", { class: "mt-5" });

  let searchTimer = null;
  nameInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = nameInput.value.trim();
    clear(suggestions);
    if (q.length < 2) return;
    searchTimer = setTimeout(async () => {
      const slug = slugSelect.value.trim();
      if (!slug) return;
      const teams = await searchTeamsByName(slug, q).catch(() => []);
      clear(suggestions);
      if (!teams.length) {
        suggestions.append(el("div", { class: "team-suggestions__empty", text: "Sin coincidencias" }));
        return;
      }
      teams.forEach((t) => {
        const btn = el("button", {
          class: "team-suggestions__item",
          type: "button",
          onclick: () => {
            nameInput.value = t.name;
            clear(suggestions);
            doLookup(t.name);
          },
        }, [
          el("span", { class: "team-suggestions__name", text: t.name }),
          el("span", { class: "team-suggestions__project", text: t.project?.name || "" }),
        ]);
        suggestions.append(btn);
      });
    }, 280);
  });

  slugSelect.addEventListener("change", () => {
    clear(suggestions);
    nameInput.value = "";
    clear(result);
  });

  async function doLookup(name) {
    const slug = slugSelect.value.trim();
    if (!slug || !name) return toast("Completa edición y nombre del equipo", "error");
    clear(result);
    clear(suggestions);
    result.append(el("p", { class: "text-muted", text: "Buscando…" }));
    try {
      const r = await teamPortalLookup(slug, name);
      if (!r?.ok) {
        clear(result);
        result.append(el("div", { class: "error-banner", text: errorMsg(r?.error) }));
        return;
      }
      const ed = editions.find((e) => e.slug === slug);
      if (ed) setCurrentEdition(ed);
      await paintResult(result, r);
    } catch {
      clear(result);
      result.append(el("div", { class: "error-banner", text: "No se pudo realizar la búsqueda." }));
    }
  }

  const form = el("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    await doLookup(nameInput.value.trim());
  }}, [
    el("div", { class: "field-row field-row--2" }, [
      el("div", { class: "field" }, [el("label", { class: "field__label", text: "Edición" }), slugSelect]),
      el("div", { class: "field" }, [
        el("label", { class: "field__label", text: "Nombre del equipo" }),
        el("div", { class: "team-search-wrap" }, [nameInput, suggestions]),
      ]),
    ]),
    el("button", { class: "btn btn--primary btn--lg", type: "submit", text: "Ver mi equipo" }),
  ]);
  wrap.append(form);
  wrap.append(result);
}

function errorMsg(code) {
  return ({
    invalid_edition_slug: "Selecciona una edición.",
    invalid_team_name: "Escribe el nombre del equipo.",
    edition_not_found: "Edición no encontrada.",
    team_not_found: "No encontramos un equipo con ese nombre. Revisa la ortografía.",
  })[code] || "No fue posible localizar tu equipo.";
}

async function paintResult(root, r) {
  clear(root);
  const { project, team, members, documents, photos, scores, edition_rank, project_rank } = r;

  root.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h2", { text: team.name }),
      el("p", { class: "text-muted", text: [
        project.name,
        project.grade_label && `Grado ${project.grade_label}`,
        team.room && `Aula ${team.room}`,
        team.presentation_order != null && `Orden ${team.presentation_order}`,
      ].filter(Boolean).join(" · ") || "—" }),
    ]),
    el("a", { class: "btn btn--ghost btn--sm", href: `#/equipos/${team.id}`, text: "Vista pública del equipo" }),
  ]));

  root.append(el("div", { class: "tag-list mb-4" }, [
    el("span", { class: "pill pill--primary", text: `Sustentación: ${fmtScore(scores?.sustentation_avg)}` }),
    el("span", { class: "pill pill--primary", text: `Concurso: ${fmtScore(scores?.field_contest_avg)}` }),
    el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(scores?.total_score)}` }),
    project_rank ? el("span", { class: "pill", text: `Puesto en el proyecto: ${project_rank}` }) : null,
    edition_rank ? el("span", { class: "pill", text: `Puesto en la feria: ${edition_rank}` }) : null,
  ]));

  const grid = el("div", { class: "grid", style: { gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "var(--space-4)" } });
  root.append(grid);

  const left = el("div", { class: "flex-col gap-4" });
  grid.append(left);

  const memCard = el("div", { class: "card" }, [el("h3", { class: "card__title", text: `Integrantes` })]);
  if (members?.length) {
    const ul = el("ul", { style: { margin: 0, padding: 0, listStyle: "none" }, class: "flex-col gap-2" });
    members.forEach((m) => ul.append(el("li", { class: "muted-card", text: m.full_name })));
    memCard.append(ul);
  } else memCard.append(el("p", { class: "text-muted", text: "Sin integrantes." }));
  left.append(memCard);

  if (project.description) {
    left.append(el("div", { class: "card" }, [
      el("h3", { class: "card__title", text: "Descripción del proyecto" }),
      el("p", { class: "text-muted", text: project.description }),
    ]));
  }

  const right = el("div", { class: "flex-col gap-4" });
  grid.append(right);

  if (documents?.length) {
    const list = el("div", { class: "flex-col gap-2" });
    for (const d of documents) {
      const url = await resolveDocUrl(d).catch(() => null);
      const icon = d.external_url ? "🔗" : "📄";
      list.append(el("a", { class: "btn btn--ghost", href: url || "#", target: "_blank", rel: "noopener", text: `${icon} ${d.title}` }));
    }
    right.append(el("div", { class: "card" }, [el("h3", { class: "card__title", text: "Documentos y enlaces" }), list]));
  }

  if (photos?.length) {
    const grid2 = el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" } });
    for (const ph of photos.slice(0, 9)) {
      const url = await signedPhotoUrl(ph.storage_path).catch(() => null);
      const slide = el("div", { style: { aspectRatio: "1/1", borderRadius: "12px", overflow: "hidden", background: "#000" } });
      if (url) slide.append(el("img", { src: url, alt: "", loading: "lazy", style: { width: "100%", height: "100%", objectFit: "cover" } }));
      grid2.append(slide);
    }
    right.append(el("div", { class: "card" }, [el("h3", { class: "card__title", text: "Fotos del equipo" }), grid2]));
  }
}
