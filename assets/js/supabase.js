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
