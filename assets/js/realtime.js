import { supabase } from "./supabase.js";

export function subscribeTable({ schema = "public", table, filter, onChange }) {
  const channelName = `rt-${table}-${filter ?? "all"}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema, table, filter },
      (payload) => {
        try { onChange?.(payload); } catch (e) { console.error(e); }
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch {}
  };
}
