import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?bundle";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

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

// Inyecta inmediatamente el access_token cacheado en el cliente Supabase
// para que las queries iniciales no vayan como anónimas.
const _cachedAtBoot = readCachedSession();
if (_cachedAtBoot?.access_token) {
  // setSession actualiza el JWT que usa PostgrestClient/Storage/Realtime.
  // No bloqueamos en el await; pero como nuestro lock es no-op debe ser inmediato.
  supabase.auth.setSession({
    access_token: _cachedAtBoot.access_token,
    refresh_token: _cachedAtBoot.refresh_token,
  }).catch((e) => console.warn("[supabase] setSession seed failed", e));
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
