import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4?bundle";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "feria-steam-auth",
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

function withTimeoutMs(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function getSession() {
  // Si Supabase tarda en responder (token expirado, refresh lento, red bloqueada),
  // devolvemos null y dejamos que la app siga; el listener onAuthStateChange
  // actualizará el estado cuando finalmente complete.
  const result = await withTimeoutMs(
    supabase.auth.getSession().then((r) => r?.data?.session ?? null).catch(() => null),
    2500,
    null
  );
  return result;
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
