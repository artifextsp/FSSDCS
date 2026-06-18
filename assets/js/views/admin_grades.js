import { el, clear, toast } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import { getGradeConfig, saveGradeConfig, defaultGradeConfig, GRADE_COLUMNS } from "../data.js?v=19";

/* ================================================================
   Admin: Notas académicas
   Configura cómo se convierten los puntos a notas:
   - Por columna (sustentación, funcionalidad, etc.): rangos de puntos.
   - Total: distribución por porcentajes aplicada por proyecto (equipos).
   Se guarda en grade_report_configs (por edición) y se refleja en el PDF.
   ================================================================ */

export async function renderGradesAdmin(body) {
  clear(body);
  const ed = getCurrentEdition();
  if (!ed) { body.append(el("div", { class: "empty", text: "Selecciona una edición." })); return; }

  body.append(el("div", { class: "loading-screen" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", { text: "Cargando configuración de notas…" }),
  ]));

  let config;
  try {
    config = await getGradeConfig(ed.id);
  } catch (err) {
    clear(body);
    body.append(el("div", { class: "error-banner", text: "Error: " + (err?.message || err) }));
    return;
  }
  clear(body);

  body.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h2", { text: "Notas académicas" }),
      el("p", { class: "text-muted", text: "Define qué columnas se convierten en nota por rangos de puntos (sustentación, funcionalidad, decoración, bonus). Las pruebas de campo se califican por ranking dentro de cada proyecto." }),
    ]),
    el("button", { class: "btn btn--ghost btn--sm", text: "Restaurar valores por defecto", onclick: async () => {
      config = defaultGradeConfig();
      renderGradesAdmin(body);
      toast("Valores por defecto cargados (recuerda guardar)", "info");
    } }),
  ]));

  // Mapa de columnas existentes en config por key (para no perder datos)
  const colByKey = {};
  (config.columns || []).forEach((c) => { colByKey[c.key] = c; });

  // ── Editor por columna ──────────────────────────────────────────
  const columnCards = [];
  GRADE_COLUMNS.forEach((meta) => {
    const existing = colByKey[meta.key] || { key: meta.key, label: meta.label, enabled: false, bands: [] };
    columnCards.push(buildColumnCard(meta, existing));
  });
  columnCards.forEach((c) => body.append(c.node));

  // ── Editor del total (porcentajes) ──────────────────────────────
  const totalCard = buildTotalCard(config.total || { label: "Promedio total", tiers: [] });
  body.append(totalCard.node);

  // ── Editor de equivalencias del promedio ───────────────────────
  const defaultPromedio = { bands: [
    { min: 1.0, max: 2.4, label: "Bajo", equivalencia: 20 },
    { min: 2.5, max: 3.4, label: "Básico", equivalencia: 35 },
    { min: 3.5, max: 4.4, label: "Alto", equivalencia: 42 },
    { min: 4.5, max: 5.0, label: "Superior", equivalencia: 48 },
  ] };
  const promedioCard = buildPromedioCard(config.promedio || defaultPromedio);
  body.append(promedioCard.node);

  // ── Guardar ─────────────────────────────────────────────────────
  const saveBtn = el("button", { class: "btn btn--primary btn--lg mt-5", text: "Guardar configuración", onclick: async () => {
    const newConfig = {
      columns: columnCards.map((c) => c.serialize()),
      total: totalCard.serialize(),
      promedio: promedioCard.serialize(),
    };
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";
    try {
      await saveGradeConfig(ed.id, newConfig);
      config = newConfig;
      toast("Configuración guardada", "success");
    } catch (err) {
      toast("No se pudo guardar: " + (err?.message || err), "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar configuración";
    }
  } });
  body.append(el("div", { class: "btn-row mt-4" }, [saveBtn]));
}

/* ---------------- Card de columna (rangos) ---------------- */
function buildColumnCard(meta, existing) {
  const enabledCb = el("input", { type: "checkbox", checked: !!existing.enabled });
  const bandsWrap = el("div", { class: "flex-col gap-2 mt-3" });
  const bandRows = [];

  function addBandRow(band = { min: 0, max: 0, nota: 3.0, label: "" }) {
    const minEl = el("input", { class: "input", type: "number", step: "0.1", value: String(band.min ?? 0), style: "width:90px;text-align:center" });
    const maxEl = el("input", { class: "input", type: "number", step: "0.1", value: String(band.max ?? 0), style: "width:90px;text-align:center" });
    const notaEl = el("input", { class: "input", type: "number", step: "0.1", value: String(band.nota ?? 0), style: "width:90px;text-align:center" });
    const labelEl = el("input", { class: "input", type: "text", value: band.label || "", placeholder: "Nivel (opcional)", style: "flex:1;min-width:120px" });
    const row = el("div", { class: "flex gap-2 items-center", style: "flex-wrap:wrap" }, [
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "Desde" }), minEl,
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "Hasta" }), maxEl,
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "→ Nota" }), notaEl,
      labelEl,
      el("button", { class: "btn btn--danger btn--sm", type: "button", text: "✕", onclick: () => {
        const i = bandRows.indexOf(ref); if (i >= 0) bandRows.splice(i, 1);
        row.remove();
      } }),
    ]);
    const ref = { row, read: () => ({
      min: parseFloat(minEl.value) || 0,
      max: parseFloat(maxEl.value) || 0,
      nota: parseFloat(notaEl.value) || 0,
      label: labelEl.value.trim(),
    }) };
    bandRows.push(ref);
    bandsWrap.append(row);
  }

  (existing.bands || []).forEach((b) => addBandRow(b));

  const addBtn = el("button", { class: "btn btn--ghost btn--sm mt-2", type: "button", text: "+ Agregar rango", onclick: () => addBandRow() });

  const inner = el("div", { class: "flex-col", style: existing.enabled ? "" : "opacity:0.55" });
  inner.append(
    el("p", { class: "text-muted", style: "font-size:0.8rem;margin:0 0 var(--space-2)", text: `Puntos de referencia: 0 a ${meta.maxRef}. Si un puntaje cae en un rango (incluidos los extremos), recibe esa nota.` }),
    bandsWrap,
    addBtn,
  );

  enabledCb.addEventListener("change", () => { inner.style.opacity = enabledCb.checked ? "" : "0.55"; });

  const node = el("div", { class: "card mt-3" }, [
    el("label", { class: "flex items-center gap-2", style: "cursor:pointer;font-weight:600;margin-bottom:var(--space-2)" }, [
      enabledCb, el("span", { text: meta.label }),
    ]),
    inner,
  ]);

  return {
    node,
    serialize: () => ({
      key: meta.key,
      label: meta.label,
      enabled: enabledCb.checked,
      bands: bandRows.map((r) => r.read()),
    }),
  };
}

/* ---------------- Card del total (porcentajes) ---------------- */
function buildTotalCard(total) {
  const tiersWrap = el("div", { class: "flex-col gap-2 mt-3" });
  const tierRows = [];
  const sumHint = el("p", { class: "text-muted", style: "font-size:0.8rem;margin:var(--space-2) 0 0" });

  function recalcHint() {
    const sum = tierRows.reduce((s, r) => s + (r.read().pct || 0), 0);
    sumHint.textContent = `Suma de porcentajes: ${sum}% ${sum === 100 ? "✓" : "(debería ser 100%)"}`;
    sumHint.style.color = sum === 100 ? "var(--color-accent)" : "var(--color-warning)";
  }

  function addTierRow(tier = { pct: 0, nota: 0, label: "" }) {
    const pctEl = el("input", { class: "input", type: "number", step: "1", min: "0", max: "100", value: String(tier.pct ?? 0), style: "width:90px;text-align:center" });
    const notaEl = el("input", { class: "input", type: "number", step: "0.1", value: String(tier.nota ?? 0), style: "width:90px;text-align:center" });
    const labelEl = el("input", { class: "input", type: "text", value: tier.label || "", placeholder: "Nivel (opcional)", style: "flex:1;min-width:120px" });
    pctEl.addEventListener("input", recalcHint);
    const row = el("div", { class: "flex gap-2 items-center", style: "flex-wrap:wrap" }, [
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "% de equipos" }), pctEl,
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "→ Nota" }), notaEl,
      labelEl,
      el("button", { class: "btn btn--danger btn--sm", type: "button", text: "✕", onclick: () => {
        const i = tierRows.indexOf(ref); if (i >= 0) tierRows.splice(i, 1);
        row.remove(); recalcHint();
      } }),
    ]);
    const ref = { row, read: () => ({
      pct: parseFloat(pctEl.value) || 0,
      nota: parseFloat(notaEl.value) || 0,
      label: labelEl.value.trim(),
    }) };
    tierRows.push(ref);
    tiersWrap.append(row);
  }

  (total.tiers || []).forEach((t) => addTierRow(t));
  recalcHint();

  const addBtn = el("button", { class: "btn btn--ghost btn--sm mt-2", type: "button", text: "+ Agregar tramo", onclick: () => { addTierRow(); recalcHint(); } });

  const node = el("div", { class: "card mt-4", style: "border:2px solid var(--color-accent)" }, [
    el("h3", { style: "margin:0 0 var(--space-1)", text: "Pruebas de campo — distribución por ranking" }),
    el("p", { class: "text-muted", style: "font-size:0.8rem;margin:0", text: "La calificación de las pruebas de campo se asigna según la clasificación general (ranking) dentro de cada proyecto: los equipos se ordenan por puntaje total de campo, el primer tramo (los mejores) recibe su nota, el siguiente tramo la suya, y así. Los integrantes heredan la nota de su equipo. Esta distribución también se imprime como nota aclaratoria en el PDF." }),
    tiersWrap,
    addBtn,
    sumHint,
  ]);

  return {
    node,
    serialize: () => ({ label: total.label || "Promedio total", tiers: tierRows.map((r) => r.read()) }),
  };
}

/* ---------------- Card de equivalencias del promedio ---------------- */
function buildPromedioCard(promedio) {
  const bandsWrap = el("div", { class: "flex-col gap-2 mt-3" });
  const bandRows = [];

  function addBandRow(band = { min: 0, max: 0, label: "", equivalencia: 0 }) {
    const minEl = el("input", { class: "input", type: "number", step: "0.1", value: String(band.min ?? 0), style: "width:80px;text-align:center" });
    const maxEl = el("input", { class: "input", type: "number", step: "0.1", value: String(band.max ?? 0), style: "width:80px;text-align:center" });
    const labelEl = el("input", { class: "input", type: "text", value: band.label || "", placeholder: "Nivel", style: "width:120px" });
    const eqEl = el("input", { class: "input", type: "number", step: "1", value: String(band.equivalencia ?? 0), style: "width:90px;text-align:center;font-weight:700;font-size:1.1rem" });
    const row = el("div", { class: "flex gap-2 items-center", style: "flex-wrap:wrap" }, [
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "Promedio desde" }), minEl,
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "hasta" }), maxEl,
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "→" }), labelEl,
      el("span", { class: "text-muted", style: "font-size:0.78rem", text: "= puntaje" }), eqEl,
      el("button", { class: "btn btn--danger btn--sm", type: "button", text: "✕", onclick: () => {
        const i = bandRows.indexOf(ref); if (i >= 0) bandRows.splice(i, 1);
        row.remove();
      } }),
    ]);
    const ref = { row, read: () => ({
      min: parseFloat(minEl.value) || 0,
      max: parseFloat(maxEl.value) || 0,
      label: labelEl.value.trim(),
      equivalencia: parseFloat(eqEl.value) || 0,
    }) };
    bandRows.push(ref);
    bandsWrap.append(row);
  }

  (promedio.bands || []).forEach((b) => addBandRow(b));

  const addBtn = el("button", { class: "btn btn--ghost btn--sm mt-2", type: "button", text: "+ Agregar nivel", onclick: () => addBandRow() });

  const node = el("div", { class: "card mt-4", style: "border:2px solid var(--color-primary)" }, [
    el("h3", { style: "margin:0 0 var(--space-1)", text: "Equivalencias del promedio — planilla del colegio" }),
    el("p", { class: "text-muted", style: "font-size:0.8rem;margin:0 0 var(--space-3)", text: "Cuando se calcula el promedio de las 4 notas (sustentación, funcionalidad, decoración, pruebas de campo), se clasifica según estos rangos. El puntaje de equivalencia es el número que aparece en la planilla de calificaciones del colegio." }),
    bandsWrap,
    addBtn,
  ]);

  return {
    node,
    serialize: () => ({ bands: bandRows.map((r) => r.read()) }),
  };
}
