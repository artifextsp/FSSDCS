import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?bundle";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const STORAGE_KEY = "feria-steam-auth";

// Bypass de navigator.locks para evitar cuelgues cross-tab en Brave/Safari.
// supabase-js usa Web Locks para coordinar refresh de token entre tabs; cuando
// hay 2+ tabs abiertos, el lock puede quedarse retenido por un tab inactivo y
// bloquear getSession() indefinidamente. Con este no-op cada tab se autorefreca
// independientemente, lo cual es seguro para una app pequeña.
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

// Lee la sesión guardada en localStorage por supabase-js, sin pasar por el
// cliente (cuyo _initialize puede ser lento). Sirve para sembrar el cache de
// auth y evitar que la UI parpadee a la pantalla de login.
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
