import { defineRoute, startRouter, navigate } from "./router.js";
import { onAuthChange, refreshAuth, signOut } from "./auth.js";
import { loadInitialEdition } from "./state.js";
import { $, $$, el, clear } from "./utils.js";

console.log("[boot] app.js evaluado");

// Fallback: si en 12s no se montó nada, mostrar mensaje de diagnóstico
setTimeout(() => {
  const main = document.querySelector("[data-app-main]");
  const stillLoading = main?.querySelector("[data-initial-loading]");
  if (stillLoading) {
    console.error("[boot] timeout — la app no terminó de iniciar");
    main.innerHTML = `
      <section class="container">
        <div class="error-banner">
          <strong>La aplicación no terminó de iniciar.</strong><br>
          Abre la consola (Cmd+Opt+J) y revisa si hay errores en rojo. Luego haz Cmd+Shift+R para recargar sin caché.
        </div>
        <p class="text-muted mt-3">Si el problema persiste, revisa que las migraciones de Supabase se hayan aplicado correctamente.</p>
        <a class="btn btn--primary mt-3" href="#/">Ir al inicio</a>
      </section>`;
  }
}, 12000);

import { renderLanding } from "./views/landing.js";
import { renderProjects } from "./views/public_projects.js";
import { renderProject } from "./views/public_project.js";
import { renderRanking } from "./views/public_ranking.js";
import { renderTeam } from "./views/team.js";
import { renderJury } from "./views/jury.js";
import { renderJuryEvaluate } from "./views/jury_evaluate.js";
import { renderJuryTeamEvaluate } from "./views/jury_evaluate.js";
import { renderPublicTeam } from "./views/public_team.js";
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
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => {
      console.warn(`[boot] timeout: ${label} (${ms}ms)`);
      resolve(null);
    }, ms)),
  ]);
}

window.addEventListener("error", (e) => console.error("[global error]", e?.error || e?.message));
window.addEventListener("unhandledrejection", (e) => console.error("[unhandled rejection]", e?.reason));

(async function boot() {
  try { await withTimeout(refreshAuth(), 8000, "refreshAuth"); }
  catch (e) { console.error("[boot] refreshAuth failed", e); }
  try { await withTimeout(loadInitialEdition(), 8000, "loadInitialEdition"); }
  catch (e) { console.error("[boot] loadInitialEdition failed", e); }
  try { startRouter(); }
  catch (e) {
    console.error("[boot] startRouter failed", e);
    const main = document.querySelector("[data-app-main]");
    if (main) {
      main.innerHTML = `<section class="container"><div class="error-banner">No se pudo iniciar la aplicación. Recarga la página.</div></section>`;
    }
  }
})();
