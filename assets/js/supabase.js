import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?bundle";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=19";

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

// =====================================================================
// PARCHE CRÍTICO: bypass del _fetchWithAuth interno de supabase-js.
//
// supabase-js v2 envuelve TODAS las queries de PostgREST/Storage con un
// custom fetch que llama `await supabase.auth.getSession()` antes de
// añadir el header Authorization. Si `_initialize` de GoTrueClient se
// cuelga (común en Brave/Safari con Web Locks o conexiones lentas), TODA
// query queda esperando indefinidamente sin disparar requests de red.
//
// Para evitarlo, mantenemos una sesión "viva" en memoria (sembrada desde
// localStorage y actualizada por onAuthStateChange) y reemplazamos el
// `fetch` interno de los sub-clientes con uno que la lee al vuelo, sin
// pasar por la maquinaria de auth.
// =====================================================================
let _liveSession = readCachedSession();

export function getLiveSession() {
  return _liveSession;
}

function buildAuthFetch() {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set("apikey", SUPABASE_KEY);
    const token = _liveSession?.access_token || SUPABASE_KEY;
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

const _staticFetch = buildAuthFetch();
try { if (supabase.rest) supabase.rest.fetch = _staticFetch; } catch {}
try { if (supabase.storage) supabase.storage.fetch = _staticFetch; } catch {}
try { if (supabase.functions) supabase.functions.fetch = _staticFetch; } catch {}

if (_liveSession?.access_token) {
  const bearer = `Bearer ${_liveSession.access_token}`;
  try { if (supabase.rest?.headers) supabase.rest.headers.Authorization = bearer; } catch {}
  try { if (supabase.storage?.headers) supabase.storage.headers.Authorization = bearer; } catch {}
  try { supabase.realtime?.setAuth?.(_liveSession.access_token); } catch {}
  console.log("[supabase] JWT cacheado inyectado + fetch estático activo");
} else {
  console.log("[supabase] sin sesión cacheada, fetch estático activo (anónimo)");
}

// Mantenemos la sesión viva sincronizada con cualquier cambio de auth.
supabase.auth.onAuthStateChange((_event, session) => {
  _liveSession = session || null;
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
});

// Override de supabase.auth.getSession() para retornar la sesión viva al
// instante. Evita que cualquier código que aún use el camino original quede
// esperando a que GoTrueClient._initialize termine su Promise.
const _origGetSession = supabase.auth.getSession.bind(supabase.auth);
supabase.auth.getSession = async () => ({
  data: { session: _liveSession },
  error: null,
});
supabase.auth.__origGetSession = _origGetSession;

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

// Símbolo especial: si en algún flujo getSession() se cuelga, devolvemos
// este símbolo para que refreshAuth no descarte la sesión cacheada.
export const GET_SESSION_TIMEOUT = Symbol("getSession timeout");

export async function getSession() {
  // Con el override de supabase.auth.getSession ya es síncrono (retorna la
  // sesión viva en memoria). Lo dejamos como Promise para no cambiar el API.
  return _liveSession || null;
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
