import { clear, el, fmtScore } from "../utils.js?v=16";
import { getCurrentEdition } from "../state.js?v=16";
import { listRanking } from "../data.js?v=16";
import { subscribeTable } from "../realtime.js?v=16";

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
  wrap.append(el("p", {
    class: "text-muted",
    text: "Cada proyecto tiene su propio ranking. Haz clic en un equipo para ver su perfil y fotos.",
  }));

  const list = el("div", { class: "flex-col gap-5 mt-3" });
  wrap.append(list);

  if (!edition) {
    list.append(el("div", { class: "empty", text: "No hay edición activa." }));
    return;
  }

  let unsub = null;
  await refresh();

  unsub = subscribeTable({
    table: "team_score_cache",
    filter: `edition_id=eq.${edition.id}`,
    onChange: refresh,
  });

  return { cleanup: () => unsub?.() };

  async function refresh() {
    try { paint(await listRanking(edition.id)); }
    catch { paint([]); }
  }

  function paint(rows) {
    clear(list);
    if (!rows.length) {
      list.append(el("div", { class: "empty", text: "Aún no hay puntajes registrados." }));
      return;
    }

    // Agrupar por proyecto conservando el orden de project_rank dentro de cada uno.
    const projectOrder = [];
    const byProject = {};
    rows.forEach((r) => {
      if (!byProject[r.project_id]) {
        projectOrder.push(r.project_id);
        byProject[r.project_id] = { name: r.project_name, teams: [] };
      }
      byProject[r.project_id].teams.push(r);
    });

    // Ordenar cada grupo por project_rank.
    projectOrder.forEach((pid) => {
      byProject[pid].teams.sort((a, b) => a.project_rank - b.project_rank);
    });

    // Ordenar grupos por nombre de proyecto.
    projectOrder.sort((a, b) =>
      byProject[a].name.localeCompare(byProject[b].name, "es", { sensitivity: "base" }),
    );

    projectOrder.forEach((pid) => {
      const { name, teams } = byProject[pid];
      const section = el("div", { class: "ranking-project" });

      section.append(
        el("div", { class: "ranking-project__header" }, [
          el("h2", { class: "ranking-project__title", text: name }),
          el("span", { class: "pill pill--ghost", text: `${teams.length} equipo${teams.length !== 1 ? "s" : ""}` }),
        ]),
      );

      const teamList = el("div", { class: "flex-col gap-2" });
      teams.forEach((r) => teamList.append(rankRow(r)));
      section.append(teamList);
      list.append(section);
    });
  }
}

function rankRow(r) {
  return el("a", {
    class: "rank-row",
    href: `#/equipos/${r.team_id}`,
    style: { textDecoration: "none", color: "inherit" },
  }, [
    el("div", {
      class: `rank-row__pos rank-row__pos--${r.project_rank <= 3 ? r.project_rank : ""}`,
      text: `${r.project_rank}`,
    }),
    el("div", {}, [
      el("div", { class: "rank-row__title", text: r.team_name }),
      el("div", {
        class: "rank-row__meta",
        text: `Sustentación ${fmtScore(r.sustentation_avg)} · Concurso ${fmtScore(r.field_contest_avg)}`,
      }),
    ]),
    el("div", { class: "rank-row__score" }, [
      `${fmtScore(r.total_score)}`,
      el("small", { text: "Total" }),
    ]),
  ]);
}
