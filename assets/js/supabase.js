import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?bundle";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=12";

export const STORAGE_KEY = "feria-steam-auth";

// Lee la sesión guardada en localStorage por supabase-js, sin pasar por el
// cliente (cuyo _initialize puede ser lento). Sirve para sembrar el cache de
// auth y para inicializar el JWT del cliente Supabase.
export function readCachedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = parsed?.currentSession || parsed?.session || parsed;
    if (!s?.access_token || !s?.user?.id) return null;
    if (s.expires_at && s.expires_at * 1000 < Date.now()) return null;
    return s;
  } catch { return null; }
}

// Bypass de navigator.locks para evitar cuelgues cross-tab en Brave/Safari.
const lockNoOp = async (_name, _timeout, fn) => fn();

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: STORAGE_KEY,
    lock: lockNoOp,
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

// Inyecta inmediatamente el access_token cacheado en TODOS los sub-clientes
// (rest/postgrest, storage, realtime) MUTANDO sus headers, sin pasar por
// supabase.auth.setSession que internamente puede hacer un network call de
// validación que se cuelga (especialmente con Brave + Web Locks).
// Cuando supabase.auth complete su _initialize el header se actualizará
// con el token refrescado; mientras tanto las queries ya funcionan.
const _cachedAtBoot = readCachedSession();
if (_cachedAtBoot?.access_token) {
  const bearer = `Bearer ${_cachedAtBoot.access_token}`;
  try { if (supabase.rest?.headers) supabase.rest.headers.Authorization = bearer; } catch {}
  try { if (supabase.storage?.headers) supabase.storage.headers.Authorization = bearer; } catch {}
  try { supabase.realtime?.setAuth?.(_cachedAtBoot.access_token); } catch {}
  console.log("[supabase] JWT cacheado inyectado en sub-clientes");
}

// Fetch directo a PostgREST con el access_token cacheado, como fallback robusto
// que NO depende del estado interno de supabase-js.
export async function fetchProfileDirect(userId, accessToken) {
  if (!userId || !accessToken) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=user_id,display_name,role&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn("[fetchProfileDirect] http", res.status);
      return null;
    }
    const arr = await res.json();
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch (e) {
    console.warn("[fetchProfileDirect] error", e);
    return null;
  }
}

// Símbolo especial: getSession() lanza este error cuando se cumple el timeout,
// para que refreshAuth no degrade una sesión válida a null por culpa de un
// refresh de token lento o un cuelgue de red.
export const GET_SESSION_TIMEOUT = Symbol("getSession timeout");

export async function getSession() {
  return Promise.race([
    supabase.auth.getSession().then((r) => r?.data?.session ?? null),
    new Promise((_, reject) =>
      setTimeout(() => reject(GET_SESSION_TIMEOUT), 2500)
    ),
  ]);
}

export async function getProfileFor(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

export async function getCurrentProfile() {
  const session = await getSession();
  if (!session) return null;
  return getProfileFor(session.user.id);
}
