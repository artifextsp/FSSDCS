import { defineRoute, startRouter, navigate, refreshCurrent } from "./router.js?v=19";
import { onAuthChange, refreshAuth, signOut } from "./auth.js?v=19";
import { loadInitialEdition, onEditionChange } from "./state.js?v=19";
import { $, $$, el, clear } from "./utils.js?v=19";
import { supabase } from "./supabase.js?v=19";

console.log("[boot] app.js evaluado");

import { renderLanding } from "./views/landing.js?v=19";
import { renderProjects } from "./views/public_projects.js?v=19";
import { renderProject } from "./views/public_project.js?v=19";
import { renderRanking } from "./views/public_ranking.js?v=19";
import { renderTeam } from "./views/team.js?v=19";
import { renderJury } from "./views/jury.js?v=19";
import { renderJuryEvaluate } from "./views/jury_evaluate.js?v=19";
import { renderJuryTeamEvaluate } from "./views/jury_evaluate.js?v=19";
import { renderPublicTeam } from "./views/public_team.js?v=19";
import { renderAdmin } from "./views/admin.js?v=19";
import { renderTeamReport } from "./views/team_report.js?v=19";

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
  // Si ya hay un modal abierto, no abrimos otro encima.
  if (document.querySelector("[data-login-modal]")) return;

  const emailEl = el("input", { class: "input", type: "email", placeholder: "correo@ejemplo.com", autocomplete: "email", inputmode: "email", autocapitalize: "none", spellcheck: false });
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
        const auth = await import("./auth.js?v=19");
        // Hard timeout: si el sign-in se cuelga (típico en mobile con red
        // intermitente o por bloqueo de Web Locks) cortamos a los 12s para
        // que el usuario no quede mirando "Ingresando…" indefinidamente.
        await Promise.race([
          auth.signInWithPassword(emailEl.value.trim(), passEl.value),
          new Promise((_, rej) => setTimeout(() => rej(new Error("Tiempo de espera agotado. Verifica tu conexión a internet e intenta nuevamente.")), 12000)),
        ]);
        // Aseguramos que el cache de auth tenga el profile antes de redirigir.
        let { profile } = auth.getAuthSnapshot();
        if (!profile) {
          // Intento adicional con timeout corto: si el fetch de profile se
          // cuelga seguimos a la home y la vista decide a dónde mandarte.
          await Promise.race([
            auth.refreshAuth(),
            new Promise((res) => setTimeout(res, 4000)),
          ]).catch(() => null);
          profile = auth.getAuthSnapshot().profile;
        }
        // Cerramos el modal antes de navegar para que el usuario vea la
        // transición del panel sin el overlay encima.
        overlay.remove();
        if (profile?.role === "admin") navigate("/admin");
        else if (profile?.role === "evaluator") navigate("/jurado");
        else navigate("/");
      } catch (err) {
        const msg = err?.message || "";
        // Mensajes amigables para los errores más comunes.
        let friendly = msg;
        if (/Invalid login/i.test(msg) || /invalid_credentials/i.test(msg)) {
          friendly = "Correo o contraseña incorrectos.";
        } else if (/Email not confirmed/i.test(msg)) {
          friendly = "Tu correo aún no está confirmado. Pídele al admin que lo verifique.";
        } else if (/Failed to fetch|NetworkError|fetch/i.test(msg)) {
          friendly = "No se pudo conectar al servidor. Verifica tu conexión a internet.";
        }
        errEl.textContent = friendly || "No se pudo iniciar sesión. Intenta de nuevo.";
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

  const overlay = el("div", { class: "modal-overlay", "data-login-modal": "" }, [
    el("div", { class: "modal" }, [
      el("div", { class: "modal__header" }, [
        el("h2", { class: "modal__title", text: "Iniciar sesión" }),
        el("button", {
          class: "modal__close",
          type: "button",
          "aria-label": "Cerrar",
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

// Cache de roles efectivos del usuario actual: además del role en profiles,
// chequeamos si tiene filas en evaluators (un admin puede ser ALSO jurado).
const effectiveRoles = { userId: null, isAdmin: false, isEvaluator: false };

async function refreshEffectiveRoles({ session, profile }) {
  const userId = session?.user?.id || null;
  if (!userId) {
    effectiveRoles.userId = null;
    effectiveRoles.isAdmin = false;
    effectiveRoles.isEvaluator = false;
    return;
  }
  effectiveRoles.userId = userId;
  effectiveRoles.isAdmin = profile?.role === "admin";
  // Aunque el role principal sea admin, el usuario puede ser jurado si tiene
  // filas en evaluators. Si su role es "evaluator" damos isEvaluator=true
  // sin consultar; si es admin, consultamos para saber si además es jurado.
  if (profile?.role === "evaluator") {
    effectiveRoles.isEvaluator = true;
    return;
  }
  try {
    const { data, error } = await supabase
      .from("evaluators")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    effectiveRoles.isEvaluator = !error && !!data?.length;
  } catch {
    effectiveRoles.isEvaluator = false;
  }
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
  // Botones de panel: pueden aparecer ambos si el usuario tiene los dos
  // roles efectivos (admin con asignaciones de jurado, por ejemplo).
  if (effectiveRoles.isAdmin) {
    authSlot.append(
      el("a", { class: "btn btn--accent btn--sm", href: "#/admin", text: "Panel admin" }),
    );
  }
  if (effectiveRoles.isEvaluator) {
    authSlot.append(
      el("a", { class: "btn btn--accent btn--sm", href: "#/jurado", text: "Panel jurado" }),
    );
  }
  authSlot.append(
    el("button", {
      class: "btn btn--ghost btn--sm",
      type: "button",
      text: "Salir",
      onclick: async () => { await signOut(); navigate("/"); },
    }),
  );
}

// Pintamos primero con lo que tengamos en cache; luego, si la sesión
// cambió, consultamos los roles efectivos y volvemos a pintar.
onAuthChange(async (state) => {
  paintAuth(state);
  const userId = state.session?.user?.id || null;
  if (userId !== effectiveRoles.userId || (userId && state.profile)) {
    await refreshEffectiveRoles(state);
    paintAuth(state);
  }
});

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
defineRoute("/mi-informe", () => renderTeamReport());
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
