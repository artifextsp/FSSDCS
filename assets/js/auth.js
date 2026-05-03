import { supabase, getCurrentProfile, getSession } from "./supabase.js";

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
  const session = await getSession();
  const profile = session ? await getCurrentProfile() : null;
  cache = { session, profile, ready: true };
  emit();
  return cache;
}

supabase.auth.onAuthStateChange(async () => {
  await refreshAuth();
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
