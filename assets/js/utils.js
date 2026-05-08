/* ---------- DOM helpers ---------- */
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset") {
      Object.entries(v).forEach(([dk, dv]) => (node.dataset[dk] = dv));
    } else if (k === "style" && typeof v === "object") {
      Object.assign(node.style, v);
    } else if (k in node && typeof node[k] !== "object") {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else {
      node.setAttribute(k, v);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ---------- Strings ---------- */
export function escapeHTML(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
export function slugify(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
export function fmtScore(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}
export function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

/* ---------- Image compression ----------
 * Usado para subir fotos desde el celular sin que excedan los 15MB del bucket
 * y para convertir HEIC/HEIF/AVIF a JPEG (formatos no aceptados). El proceso:
 *   1. createImageBitmap() decodifica casi cualquier formato soportado por
 *      el navegador (incluido HEIC en iOS Safari moderno).
 *   2. Reescalamos al lado mayor <= maxDim manteniendo proporción.
 *   3. Re-codificamos como JPEG (calidad 0.85) en un canvas y devolvemos un
 *      File con extensión .jpg y MIME image/jpeg.
 * Si algo falla (formato no decodificable en este navegador) devolvemos el
 * archivo original. La capa de upload se encargará de mostrar un error
 * legible si tampoco se puede subir directo.
 */
export async function compressImageFile(file, { maxDim = 2000, quality = 0.85 } = {}) {
  if (!file || !file.type?.startsWith("image/")) return file;
  // Si ya es pequeño Y es un mime aceptado por el bucket, no recodificamos.
  const okMime = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (okMime && file.size <= 1.5 * 1024 * 1024) return file;

  let bitmap;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    } else {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
  } catch (e) {
    console.warn("[compressImageFile] decode failed, sending original", e);
    return file;
  }

  const w0 = bitmap.width, h0 = bitmap.height;
  let w = w0, h = h0;
  if (w > maxDim || h > maxDim) {
    if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
    else { w = Math.round(w * (maxDim / h)); h = maxDim; }
  }

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  const baseName = (file.name || "foto").replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

/* ---------- Toasts ---------- */
const stack = () => document.querySelector("[data-toast-stack]");
export function toast(message, kind = "info", timeout = 3500) {
  const root = stack();
  if (!root) return;
  const t = el("div", { class: `toast toast--${kind}` , text: message });
  root.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity 200ms";
    setTimeout(() => t.remove(), 220);
  }, timeout);
}

/* ---------- Modal ---------- */
export function openModal({ title, body, actions } = {}) {
  return new Promise((resolve) => {
    const root = document.querySelector("[data-modal-root]");
    if (!root) return resolve(null);
    root.classList.add("is-open");
    const close = (val) => {
      root.classList.remove("is-open");
      while (root.firstChild) root.removeChild(root.firstChild);
      resolve(val);
    };
    const backdrop = el("div", { class: "modal-backdrop", onclick: () => close(null) });
    const titleNode = title ? el("h3", { class: "modal__title", text: title }) : null;
    const bodyNode = el("div", { class: "modal__body" });
    if (typeof body === "string") bodyNode.innerHTML = body;
    else if (body) bodyNode.appendChild(body);

    const errorBox = el("div", {
      class: "error-banner",
      style: { display: "none", marginTop: "var(--space-3)" },
    });

    const actionsNode = el("div", { class: "modal__actions" });
    const list = Array.isArray(actions) && actions.length
      ? actions
      : [{ label: "Cerrar", onClick: () => close(null) }];
    const buttons = [];
    list.forEach((a) => {
      const b = el("button", {
        class: `btn ${a.variant === "primary" ? "btn--primary" : a.variant === "danger" ? "btn--danger" : "btn--ghost"}`,
        text: a.label,
        type: "button",
      });
      b.addEventListener("click", async () => {
        errorBox.style.display = "none";
        errorBox.textContent = "";
        buttons.forEach((x) => (x.disabled = true));
        try {
          const original = a.label;
          if (a.variant === "primary") b.textContent = "Procesando…";
          const r = await (a.onClick?.() ?? null);
          if (a.variant === "primary") b.textContent = original;
          if (r === false) {
            buttons.forEach((x) => (x.disabled = false));
            return; // mantener modal abierto, error ya mostrado
          }
          close(r);
        } catch (err) {
          console.error("[modal action]", err);
          errorBox.style.display = "block";
          errorBox.textContent = err?.message ? `Error: ${err.message}` : "Ocurrió un error";
          buttons.forEach((x) => (x.disabled = false));
          if (a.variant === "primary") b.textContent = a.label;
        }
      });
      buttons.push(b);
      actionsNode.appendChild(b);
    });
    const modal = el("div", { class: "modal" }, [titleNode, bodyNode, errorBox, actionsNode]);
    modal._setError = (msg) => {
      errorBox.style.display = "block";
      errorBox.textContent = msg;
    };
    root.appendChild(backdrop);
    root.appendChild(modal);
  });
}

export function confirmDialog(message, { title = "Confirmar", okLabel = "Confirmar", danger = false } = {}) {
  return openModal({
    title,
    body: el("p", { class: "text-muted", text: message }),
    actions: [
      { label: "Cancelar", onClick: () => false },
      { label: okLabel, variant: danger ? "danger" : "primary", onClick: () => true },
    ],
  });
}

/* ---------- Network helpers ---------- */
export async function withLoader(promiseLike) {
  return await Promise.resolve(promiseLike);
}

/* ---------- Sets / sorts ---------- */
export function bySpanish(a, b, key) {
  const av = String(a?.[key] ?? "").toLocaleLowerCase("es-CO");
  const bv = String(b?.[key] ?? "").toLocaleLowerCase("es-CO");
  return av.localeCompare(bv, "es-CO");
}
