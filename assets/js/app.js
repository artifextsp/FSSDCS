import { defineRoute, startRouter, navigate, refreshCurrent } from "./router.js?v=15";
import { onAuthChange, refreshAuth, signOut } from "./auth.js?v=15";
import { loadInitialEdition, onEditionChange } from "./state.js?v=15";
import { $, $$, el, clear } from "./utils.js?v=15";

console.log("[boot] app.js evaluado");

import { renderLanding } from "./views/landing.js?v=15";
import { renderProjects } from "./views/public_projects.js?v=15";
import { renderProject } from "./views/public_project.js?v=15";
import { renderRanking } from "./views/public_ranking.js?v=15";
import { renderTeam } from "./views/team.js?v=15";
import { renderJury } from "./views/jury.js?v=15";
import { renderJuryEvaluate } from "./views/jury_evaluate.js?v=15";
import { renderJuryTeamEvaluate } from "./views/jury_evaluate.js?v=15";
import { renderPublicTeam } from "./views/public_team.js?v=15";
import { renderAdmin } from "./views/admin.js?v=15";

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

function openLoginModal() {
  const emailEl = el("input", { class: "input", type: "email", placeholder: "correo@ejemplo.com", autocomplete: "email" });
  const passEl = el("input", { class: "input", type: "password", placeholder: "Contraseña", autocomplete: "current-password" });
  const errEl = el("div", { class: "error-banner", style: { display: "none" } });

  const form = el("form", {
    class: "flex-col gap-3",
    onsubmit: async (e) => {
      e.preventDefault();
      errEl.style.display = "none";
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Ingresando…";
      try {
        const { signInWithPassword } = await import("./auth.js?v=15");
        await signInWithPassword(emailEl.value.trim(), passEl.value);
        const { getAuthSnapshot } = await import("./auth.js?v=15");
        const { profile } = getAuthSnapshot();
        // Redirect based on role
        if (profile?.role === "admin") navigate("/admin");
        else if (profile?.role === "evaluator") navigate("/jurado");
        else navigate("/");
        // Close modal
        const modal = document.querySelector(".modal-overlay");
        modal?.remove();
      } catch (err) {
        errEl.textContent = err?.message || "Correo o contraseña incorrectos.";
        errEl.style.display = "";
        btn.disabled = false;
        btn.textContent = "Ingresar";
      }
    },
  }, [
    el("p", { class: "text-muted", style: { margin: 0 }, text: "Ingresa como Administrador o Jurado." }),
    errEl,
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Correo" }), emailEl]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Contraseña" }), passEl]),
    el("button", { class: "btn btn--primary btn--block", type: "submit", text: "Ingresar" }),
  ]);

  const overlay = el("div", { class: "modal-overlay" }, [
    el("div", { class: "modal", style: { maxWidth: "360px" } }, [
      el("div", { class: "modal__header" }, [
        el("h2", { class: "modal__title", text: "Iniciar sesión" }),
        el("button", {
          class: "modal__close",
          type: "button",
          text: "✕",
          onclick: () => overlay.remove(),
        }),
      ]),
      el("div", { class: "modal__body" }, [form]),
    ]),
  ]);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  setTimeout(() => emailEl.focus(), 50);
}

function paintAuth({ session, profile }) {
  if (!authSlot) return;
  clear(authSlot);
  if (!session) {
    // Solo botón "Iniciar sesión", arriba a la izquierda junto al brand.
    authSlot.append(
      el("button", {
        class: "btn btn--primary btn--sm",
        type: "button",
        text: "Iniciar sesión",
        onclick: openLoginModal,
      }),
    );
    return;
  }
  // Estado logueado: solo el botón Salir. El admin/jurado entra a su panel
  // por el redirect del login; si necesita volver, usa marcadores o
  // re-loguea (la sesión persiste, así que el redirect es instantáneo).
  authSlot.append(
    el("button", {
      class: "btn btn--ghost btn--sm",
      type: "button",
      text: "Salir",
      onclick: async () => { await signOut(); navigate("/"); },
    }),
  );
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
