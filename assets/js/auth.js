import { supabase, getProfileFor, getSession, GET_SESSION_TIMEOUT } from "./supabase.js";

const listeners = new Set();
let cache = { session: null, profile: null, ready: false };

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

// El listener fires en INITIAL_SESSION, SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
// USER_UPDATED, PASSWORD_RECOVERY. Recibimos la sesión actual y la usamos
// directamente en lugar de re-llamar a getSession(), evitando timeouts en
// el camino de "hot path" (focus/visibility refresh).
supabase.auth.onAuthStateChange(async (_event, session) => {
  try {
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
