import { supabase, getProfileFor, getSession, GET_SESSION_TIMEOUT, readCachedSession, fetchProfileDirect } from "./supabase.js?v=15";

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
supabase.auth.onAuthStateChange(async (_event, session) => {
  try {
    syncSubclientHeaders(session);
    const profile = session ? await getProfileFor(session.user.id) : null;
    cache = { session, profile, ready: true };
    emit();
  } catch (e) {
    console.error("[auth] onAuthStateChange profile fetch failed", e);
  }
});

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
