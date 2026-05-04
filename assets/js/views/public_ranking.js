import { clear, el, fmtScore } from "../utils.js?v=12";
import { getCurrentEdition } from "../state.js?v=12";
import { listRanking } from "../data.js?v=12";
import { subscribeTable } from "../realtime.js?v=12";

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
  wrap.append(el("p", { class: "text-muted", text: "Ranking de equipos. Cada equipo compite individualmente; haz clic para ver su perfil y fotos." }));

  const list = el("div", { class: "flex-col gap-3 mt-3" });
  wrap.append(list);

  if (!edition) {
    list.append(el("div", { class: "empty", text: "No hay edición activa." })); return;
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
    if (!rows.length) { list.append(el("div", { class: "empty", text: "Aún no hay puntajes registrados." })); return; }
    rows.forEach((r) => list.append(rankRow(r)));
  }
}

function rankRow(r) {
  return el("a", {
    class: "rank-row",
    href: `#/equipos/${r.team_id}`,
    style: { textDecoration: "none", color: "inherit" },
  }, [
    el("div", { class: `rank-row__pos rank-row__pos--${r.edition_rank <= 3 ? r.edition_rank : ""}`, text: `${r.edition_rank}` }),
    el("div", {}, [
      el("div", { class: "rank-row__title", text: r.team_name }),
      el("div", { class: "rank-row__meta", text: `${r.project_name} · Sustentación ${fmtScore(r.sustentation_avg)} · Concurso ${fmtScore(r.field_contest_avg)}` }),
    ]),
    el("div", { class: "rank-row__score" }, [
      `${fmtScore(r.total_score)}`,
      el("small", { text: "Total" }),
    ]),
  ]);
}
