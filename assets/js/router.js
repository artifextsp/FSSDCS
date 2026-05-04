const routes = [];
let mounted = null;

export function defineRoute(pattern, handler) {
  routes.push({ pattern, handler, regex: toRegex(pattern), keys: keysOf(pattern) });
}

function keysOf(pattern) {
  const out = [];
  pattern.split("/").forEach((s) => {
    if (s.startsWith(":")) out.push(s.slice(1));
  });
  return out;
}

function toRegex(pattern) {
  const re = pattern
    .replace(/\//g, "\\/")
    .replace(/:([\w]+)/g, "([^/]+)");
  return new RegExp(`^${re}$`);
}

function parseHash() {
  const hash = window.location.hash || "#/";
  const cleaned = hash.replace(/^#/, "");
  const [path, queryStr = ""] = cleaned.split("?");
  const query = Object.fromEntries(new URLSearchParams(queryStr));
  return { path: path || "/", query };
}

export function navigate(path) {
  if (!path.startsWith("#")) path = "#" + path;
  if (window.location.hash === path) return resolveCurrent();
  window.location.hash = path;
}

export function getRoute() { return parseHash(); }

async function resolveCurrent() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] || "")));
      try {
        if (mounted?.cleanup) await mounted.cleanup();
      } catch (e) { console.error("cleanup error", e); }
      mounted = null;

      const result = await r.handler({ params, query });
      mounted = result || null;
      highlightActive(path);
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
  }
  // Fallback: home
  if (path !== "/") { navigate("/"); }
}

function highlightActive(path) {
  document.querySelectorAll("a[data-route]").forEach((a) => {
    const r = a.getAttribute("data-route");
    a.classList.toggle("is-active", r === path || (r !== "/" && path.startsWith(r)));
  });
}

export function startRouter() {
  window.addEventListener("hashchange", resolveCurrent);
  window.addEventListener("DOMContentLoaded", resolveCurrent);
  if (document.readyState !== "loading") resolveCurrent();
}

export function refreshCurrent() {
  return resolveCurrent();
}
