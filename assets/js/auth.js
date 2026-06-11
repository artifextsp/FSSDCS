import { supabase, getProfileFor, getSession, GET_SESSION_TIMEOUT, readCachedSession, fetchProfileDirect } from "./supabase.js?v=19";

const listeners = new Set();

// Sembramos el cache con la sesión guardada en localStorage. El perfil se
// carga vía fetch directo (con el access_token de la sesión cacheada), porque
// supabase.from(...) puede ir como anónimo si _initialize aún no terminó.
const _seed = readCachedSession();
let cache = _seed
  ? { session: _seed, profile: null, ready: true }
  : { session: null, profile: null, ready: false };
if (_seed) {
  console.log("[auth] seed: session válida, cargando perfil…");
  fetchProfileDirect(_seed.user.id, _seed.access_token)
    .then((profile) => {
      console.log("[auth] seed perfil:", profile);
      cache = { ...cache, profile };
      emit();
    })
    .catch((e) => console.warn("[auth] profile seed failed", e));
}

export function onAuthChange(cb) {
  listeners.add(cb);
  if (cache.ready) cb(cache);
  return () => listeners.delete(cb);
}

function emit() {
  listeners.forEach((cb) => {
    try { cb(cache); } catch (e) { console.error(e); }
  });
}

export async function refreshAuth() {
  try {
    const session = await getSession();
    const profile = session ? await getProfileFor(session.user.id) : null;
    cache = { session, profile, ready: true };
    emit();
  } catch (e) {
    if (e === GET_SESSION_TIMEOUT) {
      // Timeout en getSession: NO degradamos la sesión cacheada. Si todavía no
      // estábamos listos, marcamos ready=true (como anónimo) para que la UI
      // muestre login en vez del spinner; cuando supabase-js complete el
      // refresh, onAuthStateChange disparará otro refreshAuth con la sesión real.
      if (!cache.ready) {
        cache = { ...cache, ready: true };
        emit();
      }
      return cache;
    }
    console.error("[auth] refresh error", e);
    if (!cache.ready) {
      cache = { session: null, profile: null, ready: true };
      emit();
    }
  }
  return cache;
}

// Mantiene los headers de los sub-clientes Supabase sincronizados con la
// sesión activa para que las queries siempre usen el JWT vigente.
function syncSubclientHeaders(session) {
  const bearer = session?.access_token ? `Bearer ${session.access_token}` : null;
  try {
    if (supabase.rest?.headers) {
      if (bearer) supabase.rest.headers.Authorization = bearer;
      else delete supabase.rest.headers.Authorization;
    }
  } catch {}
  try {
    if (supabase.storage?.headers) {
      if (bearer) supabase.storage.headers.Authorization = bearer;
      else delete supabase.storage.headers.Authorization;
    }
  } catch {}
  try { supabase.realtime?.setAuth?.(session?.access_token || null); } catch {}
}

// El listener fires en INITIAL_SESSION, SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
// USER_UPDATED, PASSWORD_RECOVERY. Recibimos la sesión actual y la usamos
// directamente en lugar de re-llamar a getSession(), evitando timeouts en
// el camino de "hot path" (focus/visibility refresh).
supabase.auth.onAuthStateChange(async (event, session) => {
  try {
    syncSubclientHeaders(session);
    const profile = session ? await getProfileFor(session.user.id) : null;
    cache = { session, profile, ready: true };
    emit();
    // Si el jurado tiene must_change_password, mostrar modal obligatorio.
    if (event === "SIGNED_IN" && session?.user?.user_metadata?.must_change_password) {
      showMustChangePasswordModal();
    }
  } catch (e) {
    console.error("[auth] onAuthStateChange profile fetch failed", e);
  }
});

function showMustChangePasswordModal() {
  if (document.querySelector("[data-change-pw-modal]")) return;

  const errEl = document.createElement("div");
  errEl.className = "error-banner";
  errEl.style.display = "none";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("data-change-pw-modal", "");

  // Radio buttons: keep current or set new
  const radioKeep = document.createElement("input");
  radioKeep.type = "radio";
  radioKeep.name = "_cpw_choice";
  radioKeep.id = "_cpw_keep";
  radioKeep.value = "keep";
  radioKeep.checked = true;

  const radioChange = document.createElement("input");
  radioChange.type = "radio";
  radioChange.name = "_cpw_choice";
  radioChange.id = "_cpw_change";
  radioChange.value = "change";

  const labelKeep = document.createElement("label");
  labelKeep.htmlFor = "_cpw_keep";
  labelKeep.textContent = " Conservar mi contraseña actual";
  labelKeep.style.cssText = "cursor:pointer;display:flex;align-items:center;gap:6px";
  labelKeep.prepend(radioKeep);

  const labelChange = document.createElement("label");
  labelChange.htmlFor = "_cpw_change";
  labelChange.textContent = " Elegir una contraseña nueva";
  labelChange.style.cssText = "cursor:pointer;display:flex;align-items:center;gap:6px";
  labelChange.prepend(radioChange);

  const passEl = document.createElement("input");
  passEl.type = "password";
  passEl.className = "input";
  passEl.placeholder = "Nueva contraseña (mínimo 6 caracteres)";
  passEl.autocomplete = "new-password";
  passEl.style.display = "none";

  const confirmEl = document.createElement("input");
  confirmEl.type = "password";
  confirmEl.className = "input";
  confirmEl.placeholder = "Repite la contraseña";
  confirmEl.autocomplete = "new-password";
  confirmEl.style.display = "none";

  const toggleFields = () => {
    const show = radioChange.checked;
    passEl.style.display = show ? "" : "none";
    confirmEl.style.display = show ? "" : "none";
    if (show) setTimeout(() => passEl.focus(), 50);
  };
  radioKeep.addEventListener("change", toggleFields);
  radioChange.addEventListener("change", toggleFields);

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn--primary btn--block";
  saveBtn.type = "button";
  saveBtn.textContent = "Continuar";

  saveBtn.addEventListener("click", async () => {
    errEl.style.display = "none";

    if (radioChange.checked) {
      const pw = passEl.value;
      const pw2 = confirmEl.value;
      if (!pw || pw.length < 6) {
        errEl.textContent = "La contraseña debe tener al menos 6 caracteres.";
        errEl.style.display = "";
        return;
      }
      if (pw !== pw2) {
        errEl.textContent = "Las contraseñas no coinciden.";
        errEl.style.display = "";
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Guardando…";
      try {
        const { error } = await supabase.auth.updateUser({
          password: pw,
          data: { must_change_password: false },
        });
        if (error) throw error;
        overlay.remove();
      } catch (e) {
        errEl.textContent = e?.message || "No se pudo cambiar la contraseña.";
        errEl.style.display = "";
        saveBtn.disabled = false;
        saveBtn.textContent = "Continuar";
      }
    } else {
      saveBtn.disabled = true;
      saveBtn.textContent = "Guardando…";
      try {
        const { error } = await supabase.auth.updateUser({
          data: { must_change_password: false },
        });
        if (error) throw error;
        overlay.remove();
      } catch (e) {
        errEl.textContent = e?.message || "Error al guardar preferencia.";
        errEl.style.display = "";
        saveBtn.disabled = false;
        saveBtn.textContent = "Continuar";
      }
    }
  });

  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal__header">
        <h2 class="modal__title">Bienvenido/a</h2>
      </div>
      <div class="modal__body flex-col gap-3" id="_cpw_body">
        <p class="text-muted" style="margin:0">Es tu primer ingreso. Puedes conservar tu contraseña actual o elegir una nueva.</p>
      </div>
    </div>`;

  const body = overlay.querySelector("#_cpw_body");
  body.append(errEl, labelKeep, labelChange, passEl, confirmEl, saveBtn);
  document.body.append(overlay);
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await refreshAuth();
}

export async function signUp(email, password, displayName) {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  await refreshAuth();
}

export async function signOut() {
  await supabase.auth.signOut();
  await refreshAuth();
}

export function getAuthSnapshot() {
  return cache;
}
