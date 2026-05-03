import { defineRoute, startRouter, navigate } from "./router.js";
import { onAuthChange, refreshAuth, signOut } from "./auth.js";
import { loadInitialEdition } from "./state.js";
import { $, $$, el, clear } from "./utils.js";

import { renderLanding } from "./views/landing.js";
import { renderProjects } from "./views/public_projects.js";
import { renderProject } from "./views/public_project.js";
import { renderRanking } from "./views/public_ranking.js";
import { renderTeam } from "./views/team.js";
import { renderJury } from "./views/jury.js";
import { renderJuryEvaluate } from "./views/jury_evaluate.js";
import { renderAdmin } from "./views/admin.js";

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
defineRoute("/ranking", () => renderRanking());
defineRoute("/equipo", () => renderTeam());
defineRoute("/jurado", () => renderJury());
defineRoute("/jurado/proyecto/:id", ({ params }) => renderJuryEvaluate(params.id));
defineRoute("/admin", () => renderAdmin({ section: "dashboard" }));
defineRoute("/admin/:section", ({ params }) => renderAdmin({ section: params.section }));
defineRoute("/admin/proyectos/:id", ({ params }) => renderAdmin({ section: "proyecto", projectId: params.id }));

/* ---- Boot ---- */
(async function boot() {
  await refreshAuth();
  try { await loadInitialEdition(); } catch {}
  startRouter();
})();
