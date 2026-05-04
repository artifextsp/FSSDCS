import { clear, el, fmtScore, toast } from "../utils.js";
import { getAuthSnapshot, signInWithPassword, signOut } from "../auth.js";
import { listMyAssignedProjects } from "../data.js";
import { supabase } from "../supabase.js";

export async function renderJury() {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const auth = getAuthSnapshot();
  if (!auth.ready) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Verificando sesión…" }),
    ]));
    return;
  }
  if (!auth.session) return paintLogin(wrap);
  if (!auth.profile) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Cargando perfil…" }),
    ]));
    return;
  }

  if (auth.profile?.role && !["admin", "evaluator"].includes(auth.profile.role)) {
    wrap.append(el("div", { class: "error-banner", text: "Tu cuenta no tiene rol de jurado. Pide al administrador que te asigne." }));
    return;
  }

  wrap.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h1", { text: "Mis proyectos" }),
      el("p", { class: "text-muted", text: `${auth.profile?.display_name || auth.session.user.email}` }),
    ]),
    el("button", { class: "btn btn--ghost", text: "Salir", onclick: async () => { await signOut(); renderJury(); } }),
  ]));

  const list = el("div", { class: "grid grid--cards" });
  wrap.append(list);
  list.append(el("p", { class: "text-muted", text: "Cargando proyectos asignados…" }));

  let projects = [];
  try {
    projects = await listMyAssignedProjects();
  } catch (e) {
    clear(list);
    list.append(el("div", { class: "error-banner", text: "No se pudieron cargar tus proyectos." }));
    return;
  }
  clear(list);
  if (!projects.length) {
    list.append(el("div", { class: "empty", text: "Aún no tienes proyectos asignados." }));
    return;
  }
  projects.forEach((p) => {
    list.append(el("a", {
      class: "project-card",
      href: `#/jurado/proyecto/${p.id}`,
    }, [
      el("div", { class: "project-card__cover project-card__cover--placeholder" }),
      el("div", { class: "project-card__title", text: p.name }),
      el("div", { class: "project-card__meta", text: [p.grade_label, p.room].filter(Boolean).join(" · ") || "—" }),
      el("div", { class: "btn btn--primary btn--sm", text: "Evaluar →" }),
    ]));
  });
}

function paintLogin(root) {
  const emailEl = el("input", { class: "input", type: "email", required: true, autocomplete: "username", placeholder: "tu@correo.com" });
  const passEl = el("input", { class: "input", type: "password", required: true, autocomplete: "current-password", placeholder: "••••••••" });
  const errBox = el("div", { class: "field__error" });

  const form = el("form", { class: "card auth-shell", onsubmit: async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      await signInWithPassword(emailEl.value.trim(), passEl.value);
      renderJury();
    } catch (err) {
      errBox.textContent = err?.message || "No se pudo iniciar sesión";
    } finally {
      if (btn) btn.disabled = false;
    }
  }}, [
    el("h1", { text: "Acceso jurado" }),
    el("p", { class: "text-muted mb-3", text: "Inicia sesión con la cuenta que te entregó el administrador." }),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Correo" }), emailEl]),
    el("div", { class: "field" }, [el("label", { class: "field__label", text: "Contraseña" }), passEl]),
    errBox,
    el("button", { class: "btn btn--primary btn--lg btn--block", type: "submit", text: "Entrar" }),
    el("p", { class: "text-soft mt-3", style: { fontSize: "0.8rem", textAlign: "center" }, text: "¿Es tu primera vez? El administrador debe crearte la cuenta y asignarte como jurado en una edición." }),
  ]);
  root.append(form);
}
