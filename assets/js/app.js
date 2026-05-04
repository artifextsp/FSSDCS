import { defineRoute, startRouter, navigate, refreshCurrent } from "./router.js?v=12";
import { onAuthChange, refreshAuth, signOut } from "./auth.js?v=12";
import { loadInitialEdition, onEditionChange } from "./state.js?v=12";
import { $, $$, el, clear } from "./utils.js?v=12";

console.log("[boot] app.js evaluado");

import { renderLanding } from "./views/landing.js?v=12";
import { renderProjects } from "./views/public_projects.js?v=12";
import { renderProject } from "./views/public_project.js?v=12";
import { renderRanking } from "./views/public_ranking.js?v=12";
import { renderTeam } from "./views/team.js?v=12";
import { renderJury } from "./views/jury.js?v=12";
import { renderJuryEvaluate } from "./views/jury_evaluate.js?v=12";
import { renderJuryTeamEvaluate } from "./views/jury_evaluate.js?v=12";
import { renderPublicTeam } from "./views/public_team.js?v=12";
import { renderAdmin } from "./views/admin.js?v=12";

/* ---- Header interactions ---- */
const navToggle = $("[data-nav-toggle]");
const primaryNav = $("[data-primary-nav]");
navToggle?.addEventListener("click", () => {
  const open = primaryNav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(open));
});
$$("a[data-route]").forEach((a) =>
  a.addEventListener("click", () => primaryNav?.classList.remove("is-open"))
);

const yearEl = $("[data-current-year]");
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ---- Auth slot in nav ---- */
const authSlot = $("[data-auth-slot]");
function paintAuth({ session, profile }) {
  if (!authSlot) return;
  clear(authSlot);
  if (!session) return;
  const name = profile?.display_name || session.user.email;
  const role = profile?.role || "—";
  authSlot.append(
    el("span", { class: "pill pill--primary", text: role }),
    el("span", { class: "text-muted", text: name }),
    el("button", { class: "btn btn--ghost btn--sm", text: "Salir", onclick: async () => { await signOut(); navigate("/"); } })
  );
  // Show/hide role-only nav items
  $$("[data-role-only]").forEach((node) => {
    const want = node.getAttribute("data-role-only");
    node.classList.toggle("is-visible", profile?.role === want);
  });
}
onAuthChange(paintAuth);

/* ---- Routes ---- */
defineRoute("/", () => renderLanding());
defineRoute("/proyectos", () => renderProjects());
defineRoute("/proyectos/:id", ({ params }) => renderProject(params.id));
defineRoute("/equipos/:id", ({ params }) => renderPublicTeam(params.id));
defineRoute("/ranking", () => renderRanking());
defineRoute("/equipo", () => renderTeam());
defineRoute("/jurado", () => renderJury());
defineRoute("/jurado/proyecto/:id", ({ params }) => renderJuryEvaluate(params.id));
defineRoute("/jurado/equipo/:id", ({ params }) => renderJuryTeamEvaluate(params.id));
defineRoute("/admin", () => renderAdmin({ section: "dashboard" }));
defineRoute("/admin/proyectos/:id", ({ params }) => renderAdmin({ section: "proyecto", projectId: params.id }));
defineRoute("/admin/equipos/:id", ({ params }) => renderAdmin({ section: "team", teamId: params.id }));
defineRoute("/admin/:section", ({ params }) => renderAdmin({ section: params.section }));

/* ---- Boot ---- */
window.addEventListener("error", (e) => console.error("[global error]", e?.error || e?.message));
window.addEventListener("unhandledrejection", (e) => console.error("[unhandled rejection]", e?.reason));

// Arranca el router YA. La auth y la edición se resuelven en background
// y disparan un re-render de la vista actual cuando llegan.
try {
  startRouter();
  console.log("[boot] router iniciado");
} catch (e) {
  console.error("[boot] startRouter failed", e);
  const main = document.querySelector("[data-app-main]");
  if (main) {
    main.innerHTML = `<section class="container"><div class="error-banner">No se pudo iniciar la aplicación. Recarga la página.</div></section>`;
  }
}

const t0 = performance.now();
let lastAuthKey = null;
let lastEditionId = null;

onAuthChange((s) => {
  const key = `${s?.session?.user?.id || ""}:${s?.profile?.role || ""}`;
  if (key === lastAuthKey) return;
  lastAuthKey = key;
  console.log(`[boot] auth update (+${Math.round(performance.now() - t0)}ms)`);
  refreshCurrent().catch((e) => console.error("[boot] refresh failed", e));
});
onEditionChange((ed) => {
  if (ed?.id === lastEditionId) return;
  lastEditionId = ed?.id || null;
  console.log(`[boot] edición update (+${Math.round(performance.now() - t0)}ms)`);
  refreshCurrent().catch((e) => console.error("[boot] refresh failed", e));
});

// Disparamos refreshAuth a mano por si onAuthStateChange (INITIAL_SESSION)
// tarda en activarse. getSession() tiene timeout interno de 2.5s.
refreshAuth().catch((e) => console.error("[boot] refreshAuth failed", e));
loadInitialEdition().catch((e) => console.error("[boot] loadInitialEdition failed", e));
