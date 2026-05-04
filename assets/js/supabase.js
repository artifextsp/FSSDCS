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

// Si hay sesión cacheada, pasamos su access_token como Authorization header
// global desde la creación del cliente. Así TODAS las queries (PostgREST,
// Storage, etc.) van autenticadas desde el primer milisegundo, sin esperar a
// que supabase.auth._initialize() termine. Cuando _initialize complete, el
// cliente actualizará el header internamente con el token refrescado.
const _cachedAtBoot = readCachedSession();
const _initialHeaders = _cachedAtBoot?.access_token
  ? { Authorization: `Bearer ${_cachedAtBoot.access_token}` }
  : undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: STORAGE_KEY,
    lock: lockNoOp,
  },
  global: _initialHeaders ? { headers: _initialHeaders } : undefined,
  realtime: { params: { eventsPerSecond: 5 } },
});

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
