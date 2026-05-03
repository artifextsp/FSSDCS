/**
 * Parsers de listados de estudiantes (CSV / XLSX / PDF) en frontend vanilla.
 * Devuelven un arreglo de filas: { full_name, ...extras }.
 */

export async function parseFile(file) {
  const name = file.name?.toLowerCase() || "";
  if (name.endsWith(".csv") || file.type === "text/csv") {
    return parseCSV(await file.text());
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") ||
      file.type?.includes("spreadsheetml") || file.type?.includes("ms-excel")) {
    return parseXLSX(file);
  }
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return parsePDF(file);
  }
  // Fallback: probar como texto
  const txt = await file.text();
  return parseCSV(txt);
}

/* ---------------- CSV ---------------- */
export function parseCSV(text) {
  const rows = csvToRows(text);
  return rowsToMembers(rows);
}

function csvToRows(text) {
  const out = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { q = false; }
      else { cur += c; }
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === ";") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some((x) => x.trim() !== "")) out.push(row);
        row = [];
      } else { cur += c; }
    }
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some((x) => x.trim() !== "")) out.push(row);
  }
  return out;
}

/* ---------------- XLSX ---------------- */
let _xlsxPromise = null;
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  if (!_xlsxPromise) {
    _xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.async = true;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error("No se pudo cargar XLSX"));
      document.head.appendChild(s);
    });
  }
  return _xlsxPromise;
}

export async function parseXLSX(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  return rowsToMembers(rows);
}

/* ---------------- PDF ---------------- */
let _pdfPromise = null;
async function loadPDF() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (!_pdfPromise) {
    _pdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.async = true;
      s.onload = () => {
        const pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(pdfjsLib);
      };
      s.onerror = () => reject(new Error("No se pudo cargar PDF.js"));
      document.head.appendChild(s);
    });
  }
  return _pdfPromise;
}

export async function parsePDF(file) {
  const pdfjsLib = await loadPDF();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items.map((it) => ({
      str: (it.str || "").trim(),
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
    }));
    // Agrupar por línea aproximada (Y casi igual)
    const buckets = new Map();
    items.forEach((it) => {
      if (!it.str) return;
      const y = Math.round(it.y);
      const key = y;
      const arr = buckets.get(key) || [];
      arr.push(it);
      buckets.set(key, arr);
    });
    [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, arr]) => {
        const text = arr.sort((a, b) => a.x - b.x).map((a) => a.str).join(" ").replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
      });
  }
  // Filtrar líneas que parezcan nombres
  const nameRows = lines
    .map((l) => l.replace(/^[•\-\d.\)\(]+\s*/, "").trim())
    .filter((l) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,}\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,}/.test(l))
    .filter((l) => l.length <= 80);
  return rowsToMembers(nameRows.map((n) => [n]));
}

/* ---------------- Common ---------------- */
function rowsToMembers(rows) {
  if (!rows?.length) return [];
  const norm = (v) => String(v ?? "").trim();
  // Buscar fila de cabecera que contenga "nombre"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i].map(norm).map((x) => x.toLowerCase());
    if (r.some((c) => c.includes("nombre") || c.includes("estudiante") || c === "name")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx >= 0) {
    const header = rows[headerIdx].map(norm);
    const lower = header.map((h) => h.toLowerCase());
    const nameCol = lower.findIndex((c) => c.includes("nombre") || c.includes("estudiante") || c === "name");
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i].map(norm);
      const fullName = r[nameCol] || r.filter(Boolean).join(" ").trim();
      if (!fullName) continue;
      const extras = {};
      header.forEach((h, idx) => {
        if (idx === nameCol) return;
        if (r[idx]) extras[h] = r[idx];
      });
      out.push({ full_name: fullName, extras });
    }
    return out;
  }
  // Sin cabecera: tomar primera columna no vacía como nombre completo
  return rows
    .map((r) => r.map(norm))
    .map((r) => ({ full_name: r.find((x) => x) || "" }))
    .filter((m) => m.full_name);
}
