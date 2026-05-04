/**
 * Estado ligero de aplicación (edición seleccionada).
 */
import { listEditionsAccessible } from "./data.js";

const KEY = "feria-steam-edition-id";

let cache = { edition: null };

export async function loadInitialEdition() {
  const stored = localStorage.getItem(KEY);
  const list = await listEditionsAccessible().catch(() => []);
  if (!list.length) return null;
  if (stored) {
    const found = list.find((e) => e.id === stored);
    if (found) { cache.edition = found; return cache.edition; }
  }
  const active = list.find((e) => e.status === "active") || list[0];
  if (active) { cache.edition = active; localStorage.setItem(KEY, active.id); }
  return cache.edition;
}

export function getCurrentEdition() { return cache.edition; }

export function setCurrentEdition(edition) {
  cache.edition = edition;
  if (edition?.id) localStorage.setItem(KEY, edition.id);
  else localStorage.removeItem(KEY);
}
