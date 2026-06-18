import { el, clear, toast, fmtScore } from "../utils.js?v=19";
import { getCurrentEdition } from "../state.js?v=19";
import { supabase } from "../supabase.js?v=19";
import {
  listProjects,
  getGradeConfig,
  listFieldCompetitions,
  listFieldResultsByCompetition,
  analyticsGetTeamMembers,
} from "../data.js?v=19";

/* ================================================================
   Admin: Planillas de Notas por Grado
   Permite descargar listados (Excel / PDF) de las notas académicas
   generadas en la feria, agrupados por grado y ordenados
   alfabéticamente por apellido.
   ================================================================ */

// ─── Carga diferida de librerías CDN ────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar: " + src));
    document.head.append(s);
  });
}

async function loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf;
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js");
  return window.jspdf;
}

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
  return window.XLSX;
}

// ─── Conversión de puntos a notas académicas ────────────────────
function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function notaFromBands(points, bands) {
  if (points == null || !Array.isArray(bands)) return null;
  for (const b of bands) {
    if (points >= Number(b.min) && points <= Number(b.max))
      return { nota: Number(b.nota), label: b.label || "" };
  }
  return null;
}

function notaFromPercentile(rank, count, tiers) {
  if (!rank || !count || !Array.isArray(tiers) || !tiers.length) return null;
  let cumulative = 0;
  for (let i = 0; i < tiers.length; i++) {
    cumulative += Number(tiers[i].pct) || 0;
    const isLast = i === tiers.length - 1;
    const boundary = isLast ? count : Math.round((count * cumulative) / 100);
    if (rank <= boundary)
      return { nota: Number(tiers[i].nota), label: tiers[i].label || "" };
  }
  const last = tiers[tiers.length - 1];
  return { nota: Number(last.nota), label: last.label || "" };
}

// Clasifica el promedio en un nivel y devuelve { label, equivalencia }
function clasificarPromedio(promedio, promedioBands) {
  if (promedio == null || !Array.isArray(promedioBands)) return null;
  for (const b of promedioBands) {
    if (promedio >= Number(b.min) && promedio <= Number(b.max))
      return { label: b.label || "", equivalencia: Number(b.equivalencia) || 0 };
  }
  return null;
}

// ─── Heurística para extraer clave de ordenamiento por apellido ─
// Convención colombiana: NOMBRE1 [NOMBRE2] APELLIDO1 [APELLIDO2]
function sortKeyApellido(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return (fullName || "").toLowerCase();
  if (parts.length === 2) return parts[1].toLowerCase();
  // 3+ partes: primer apellido está en la posición ceil(length/2)
  const idx = Math.ceil(parts.length / 2);
  return parts.slice(idx).join(" ").toLowerCase() + " " + parts.slice(0, idx).join(" ").toLowerCase();
}

function fmtDateLong() {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeStyle: "short" }).format(new Date());
}

// ─── Render principal ───────────────────────────────────────────
export async function renderGradeSheetsAdmin(body) {
  clear(body);
  const ed = getCurrentEdition();
  if (!ed) {
    body.append(el("div", { class: "empty", text: "Selecciona una edición." }));
    return;
  }

  body.append(el("div", { class: "loading-screen" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", { text: "Recopilando datos de notas…" }),
  ]));

  let gradeData;
  try {
    gradeData = await buildGradeData(ed);
  } catch (err) {
    clear(body);
    body.append(el("div", { class: "error-banner", text: "Error al cargar datos: " + (err?.message || err) }));
    return;
  }
  clear(body);

  const { studentsByGrade, gradeLabels, editionName } = gradeData;

  body.append(el("div", { class: "section-head" }, [
    el("div", {}, [
      el("h2", { text: "Planillas de notas por grado" }),
      el("p", { class: "text-muted", text: "Descarga las calificaciones de la feria organizadas por grado. Cada planilla incluye: Sustentación, Funcionalidad del prototipo, Decoración del prototipo y nota por puesto en pruebas de campo. Ordenadas alfabéticamente por apellido." }),
    ]),
  ]));

  if (!gradeLabels.length) {
    body.append(el("div", { class: "empty mt-4", text: "No se encontraron equipos con grado asignado ni estudiantes registrados en esta edición." }));
    return;
  }

  // Resumen general
  const totalStudents = gradeLabels.reduce((s, g) => s + studentsByGrade[g].length, 0);
  body.append(
    el("div", {
      class: "grid mt-4",
      style: { gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: "var(--space-4)" },
    }, [
      metricCard("Grados", gradeLabels.length),
      metricCard("Estudiantes", totalStudents),
    ])
  );

  // Botón descargar todo
  body.append(
    el("div", { class: "card mt-5" }, [
      el("h3", { class: "card__title", text: "Descargar todos los grados" }),
      el("p", { class: "text-muted", style: { fontSize: "0.85rem", marginBottom: "var(--space-3)" },
        text: "Genera un archivo con una hoja/página por cada grado." }),
      el("div", { class: "btn-row" }, [
        el("button", {
          class: "btn btn--primary",
          text: "⬇ Excel (todos los grados)",
          onclick: (e) => exportAllGradesExcel(e.currentTarget, gradeData),
        }),
        el("button", {
          class: "btn btn--accent",
          text: "⬇ PDF (todos los grados)",
          onclick: (e) => exportAllGradesPDF(e.currentTarget, gradeData),
        }),
      ]),
    ])
  );

  // Tarjetas por grado
  body.append(el("h3", { class: "mt-6", style: { marginBottom: "var(--space-3)" }, text: "Por grado" }));

  const gradeGrid = el("div", { class: "flex-col gap-3" });
  body.append(gradeGrid);

  for (const grade of gradeLabels) {
    const students = studentsByGrade[grade];
    const card = el("div", { class: "card", style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" } }, [
      el("div", {}, [
        el("p", { style: { fontWeight: 700, margin: 0, fontSize: "1.05rem" }, text: `Grado ${grade}` }),
        el("p", { class: "text-muted", style: { margin: "2px 0 0", fontSize: "0.85rem" },
          text: `${students.length} estudiante${students.length !== 1 ? "s" : ""} · ${new Set(students.map((s) => s.teamName)).size} equipo(s)` }),
      ]),
      el("div", { class: "flex gap-2", style: { flexWrap: "wrap" } }, [
        el("button", {
          class: "btn btn--primary btn--sm",
          text: "⬇ Excel",
          onclick: (e) => exportGradeExcel(e.currentTarget, grade, students, editionName),
        }),
        el("button", {
          class: "btn btn--accent btn--sm",
          text: "⬇ PDF",
          onclick: (e) => exportGradePDF(e.currentTarget, grade, students, editionName),
        }),
        el("button", {
          class: "btn btn--ghost btn--sm",
          text: "Vista previa",
          onclick: () => togglePreview(card, grade, students),
        }),
      ]),
    ]);
    gradeGrid.append(card);
  }
}

// ─── Preview toggle ──────────────────────────────────────────────
function togglePreview(card, grade, students) {
  const existing = card.querySelector("[data-preview]");
  if (existing) { existing.remove(); return; }

  const rows = students.map((s, i) => [
    i + 1,
    s.fullName,
    s.teamName,
    s.notaSustentacion != null ? fmtScore(s.notaSustentacion) : "—",
    s.notaFuncionalidad != null ? fmtScore(s.notaFuncionalidad) : "—",
    s.notaDecoracion != null ? fmtScore(s.notaDecoracion) : "—",
    s.notaCampo != null ? fmtScore(s.notaCampo) : "—",
    s.promedio != null ? fmtScore(s.promedio) : "—",
    s.nivel || "—",
    s.equivalencia != null ? String(s.equivalencia) : "—",
  ]);

  const headers = ["#", "Nombre completo", "Equipo", "Sustentación", "Funcionalidad", "Decoración", "Pruebas campo", "Promedio", "Nivel", "Equiv."];
  const preview = el("div", { "data-preview": "1", style: { marginTop: "var(--space-4)", borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)", overflowX: "auto" } }, [
    buildTable(headers, rows),
  ]);
  card.append(preview);
}

// ═══════════════════════════════════════════════════════════════
//  Construcción del dataset de notas
// ═══════════════════════════════════════════════════════════════
async function buildGradeData(edition) {
  const editionId = edition.id;

  // Cargar en paralelo lo que podamos
  const [projects, gradeConfig, allTeamsRes, scoreCacheRes] = await Promise.all([
    listProjects(editionId),
    getGradeConfig(editionId),
    supabase.from("teams").select("id, name, project_id, grade_label, edition_id").eq("edition_id", editionId),
    supabase.from("team_score_cache").select("team_id, project_id, sustentation_avg, field_contest_avg, total_score").eq("edition_id", editionId),
  ]);

  if (allTeamsRes.error) throw allTeamsRes.error;
  const allTeams = allTeamsRes.data || [];
  const scoreCache = Object.fromEntries((scoreCacheRes.data || []).map((s) => [s.team_id, s]));

  const teamIds = allTeams.map((t) => t.id);
  const members = teamIds.length ? await analyticsGetTeamMembers(teamIds) : [];

  // Agrupar miembros por equipo
  const membersByTeam = {};
  members.forEach((m) => {
    if (!membersByTeam[m.team_id]) membersByTeam[m.team_id] = [];
    membersByTeam[m.team_id].push(m);
  });

  // Cargar pruebas de campo para funcionalidad/decoración (ronda 0)
  // y para el ranking por proyecto
  const competitions = await listFieldCompetitions(editionId);
  const compByProject = {};
  competitions.forEach((c) => { compByProject[c.project_id] = c; });

  const fieldResultsByComp = {};
  for (const comp of competitions) {
    fieldResultsByComp[comp.id] = await listFieldResultsByCompetition(comp.id);
  }

  // Construir ranking de campo por proyecto (para notaFromPercentile)
  // y extraer funcionalidad/decoración de ronda 0
  const fieldRankByProject = {};  // { projectId: { teamId: rank } }
  const fieldCountByProject = {}; // { projectId: totalTeams }
  const protoMetaByTeam = {};     // { teamId: { funcionalidad, decoracion } }

  for (const proj of projects) {
    const comp = compByProject[proj.id];
    if (!comp) continue;
    const results = fieldResultsByComp[comp.id] || [];

    // Extraer meta de ronda 0 (prototipo)
    results.forEach((r) => {
      if (Number(r.round?.round_number) === 0 && r.meta) {
        const tid = r.team?.id || r.team_id;
        protoMetaByTeam[tid] = {
          funcionalidad: numOrNull(r.meta.funcionalidad),
          decoracion: numOrNull(r.meta.decoracion),
        };
      }
    });

    // Ranking de campo por total de puntos (todas las rondas)
    const teamTotals = {};
    results.forEach((r) => {
      const tid = r.team?.id || r.team_id;
      teamTotals[tid] = (teamTotals[tid] || 0) + (Number(r.computed_points) || 0);
    });
    const sorted = Object.entries(teamTotals).sort((a, b) => b[1] - a[1]);
    fieldCountByProject[proj.id] = sorted.length;
    const rankMap = {};
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i][1] < sorted[i - 1][1]) rank = i + 1;
      rankMap[sorted[i][0]] = rank;
    }
    fieldRankByProject[proj.id] = rankMap;
  }

  // Configuración de bandas por columna
  const colConfig = {};
  (gradeConfig.columns || []).forEach((c) => { colConfig[c.key] = c; });
  const totalTiers = gradeConfig.total?.tiers || [];

  // Mapa de proyectos para heredar grade_label
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));

  // Construir lista de estudiantes con sus 4 notas
  const studentsByGrade = {};

  for (const team of allTeams) {
    if (!team.grade_label) continue;
    const proj = projectMap[team.project_id];
    const grade = team.grade_label;
    if (!studentsByGrade[grade]) studentsByGrade[grade] = [];

    const teamMembers = membersByTeam[team.id] || [];
    if (!teamMembers.length) continue;

    const cache = scoreCache[team.id] || {};
    const proto = protoMetaByTeam[team.id] || {};

    // Sustentación: convertir sustentation_avg a nota
    const sustPts = numOrNull(cache.sustentation_avg);
    const sustCol = colConfig.sustentation;
    const sustResult = (sustCol?.enabled && sustPts != null) ? notaFromBands(sustPts, sustCol.bands || []) : null;
    const notaSustentacion = sustResult?.nota ?? null;

    // Funcionalidad: convertir funcionalidad pts a nota
    const funcPts = proto.funcionalidad;
    const funcCol = colConfig.funcionalidad;
    const funcResult = (funcCol?.enabled && funcPts != null) ? notaFromBands(funcPts, funcCol.bands || []) : null;
    const notaFuncionalidad = funcResult?.nota ?? null;

    // Decoración: convertir decoracion pts a nota
    const decoPts = proto.decoracion;
    const decoCol = colConfig.decoracion;
    const decoResult = (decoCol?.enabled && decoPts != null) ? notaFromBands(decoPts, decoCol.bands || []) : null;
    const notaDecoracion = decoResult?.nota ?? null;

    // Pruebas de campo: nota por percentil (ranking dentro del proyecto)
    const projRanks = fieldRankByProject[team.project_id] || {};
    const myRank = projRanks[team.id];
    const projCount = fieldCountByProject[team.project_id] || 0;
    const campoResult = (totalTiers.length && myRank && projCount)
      ? notaFromPercentile(myRank, projCount, totalTiers)
      : null;
    const notaCampo = campoResult?.nota ?? null;

    // Promedio de las 4 notas (solo las que tengan valor)
    const notas = [notaSustentacion, notaFuncionalidad, notaDecoracion, notaCampo].filter((n) => n != null);
    const promedio = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;

    // Clasificar promedio → nivel + equivalencia numérica
    const promedioBands = gradeConfig.promedio?.bands || [];
    const clasif = promedio != null ? clasificarPromedio(promedio, promedioBands) : null;
    const nivel = clasif?.label ?? null;
    const equivalencia = clasif?.equivalencia ?? null;

    for (const member of teamMembers) {
      studentsByGrade[grade].push({
        fullName: member.full_name,
        teamName: team.name,
        projectName: proj?.name || "",
        gradeLabel: grade,
        notaSustentacion,
        notaFuncionalidad,
        notaDecoracion,
        notaCampo,
        promedio,
        nivel,
        equivalencia,
        _sortKey: sortKeyApellido(member.full_name),
      });
    }
  }

  // Ordenar cada grado por apellido
  for (const grade of Object.keys(studentsByGrade)) {
    studentsByGrade[grade].sort((a, b) => a._sortKey.localeCompare(b._sortKey, "es"));
  }

  const gradeLabels = Object.keys(studentsByGrade)
    .filter((g) => studentsByGrade[g].length > 0)
    .sort((a, b) => {
      const na = parseInt(a) || 999;
      const nb = parseInt(b) || 999;
      return na - nb || a.localeCompare(b, "es");
    });

  return {
    studentsByGrade,
    gradeLabels,
    editionName: `${edition.name} ${edition.year}`,
  };
}

// ═══════════════════════════════════════════════════════════════
//  Exportación Excel — un grado
// ═══════════════════════════════════════════════════════════════
async function exportGradeExcel(btn, grade, students, editionName) {
  btn.disabled = true; btn.textContent = "Generando…";
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    addGradeSheet(XLSX, wb, grade, students, editionName);
    const safeName = grade.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    XLSX.writeFile(wb, `notas-grado-${safeName}.xlsx`);
    toast("Excel descargado", "success");
  } catch (err) {
    console.error("[planillas] Excel error", err);
    toast("Error al generar el Excel: " + (err?.message || err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "⬇ Excel";
  }
}

// ═══════════════════════════════════════════════════════════════
//  Exportación Excel — todos los grados
// ═══════════════════════════════════════════════════════════════
async function exportAllGradesExcel(btn, gradeData) {
  btn.disabled = true; btn.textContent = "Generando…";
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    for (const grade of gradeData.gradeLabels) {
      addGradeSheet(XLSX, wb, grade, gradeData.studentsByGrade[grade], gradeData.editionName);
    }
    XLSX.writeFile(wb, `notas-todos-los-grados.xlsx`);
    toast("Excel descargado", "success");
  } catch (err) {
    console.error("[planillas] Excel all error", err);
    toast("Error al generar el Excel: " + (err?.message || err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "⬇ Excel (todos los grados)";
  }
}

function addGradeSheet(XLSX, wb, grade, students, editionName) {
  const sheetName = `Grado ${grade}`.slice(0, 31);

  const header = [
    ["FERIA STEAM — Seminario Diocesano Cristo Sacerdote"],
    [editionName],
    [`Grado: ${grade}`, "", "", "", "", "", "", "", "", `Generado: ${fmtDateLong()}`],
    [],
    ["#", "Nombre completo", "Equipo", "Sustentación", "Funcionalidad", "Decoración", "Pruebas de campo", "Promedio", "Nivel", "Equivalencia"],
  ];

  const rows = students.map((s, i) => [
    i + 1,
    s.fullName,
    s.teamName,
    s.notaSustentacion != null ? s.notaSustentacion : "",
    s.notaFuncionalidad != null ? s.notaFuncionalidad : "",
    s.notaDecoracion != null ? s.notaDecoracion : "",
    s.notaCampo != null ? s.notaCampo : "",
    s.promedio != null ? Math.round(s.promedio * 100) / 100 : "",
    s.nivel || "",
    s.equivalencia != null ? s.equivalencia : "",
  ]);

  const data = [...header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);

  ws["!cols"] = [
    { wch: 5 },   // #
    { wch: 38 },  // Nombre
    { wch: 25 },  // Equipo
    { wch: 14 },  // Sustentación
    { wch: 14 },  // Funcionalidad
    { wch: 14 },  // Decoración
    { wch: 16 },  // Pruebas de campo
    { wch: 12 },  // Promedio
    { wch: 12 },  // Nivel
    { wch: 14 },  // Equivalencia
  ];

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

// ═══════════════════════════════════════════════════════════════
//  Exportación PDF — un grado
// ═══════════════════════════════════════════════════════════════
async function exportGradePDF(btn, grade, students, editionName) {
  btn.disabled = true; btn.textContent = "Generando…";
  try {
    const { jsPDF } = await loadJsPDF();
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
    addGradePage(doc, grade, students, editionName, true);
    const safeName = grade.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    doc.save(`notas-grado-${safeName}.pdf`);
    toast("PDF descargado", "success");
  } catch (err) {
    console.error("[planillas] PDF error", err);
    toast("Error al generar el PDF: " + (err?.message || err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "⬇ PDF";
  }
}

// ═══════════════════════════════════════════════════════════════
//  Exportación PDF — todos los grados
// ═══════════════════════════════════════════════════════════════
async function exportAllGradesPDF(btn, gradeData) {
  btn.disabled = true; btn.textContent = "Generando…";
  try {
    const { jsPDF } = await loadJsPDF();
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
    gradeData.gradeLabels.forEach((grade, i) => {
      if (i > 0) doc.addPage();
      addGradePage(doc, grade, gradeData.studentsByGrade[grade], gradeData.editionName, true);
    });
    addPdfFooter(doc);
    doc.save("notas-todos-los-grados.pdf");
    toast("PDF descargado", "success");
  } catch (err) {
    console.error("[planillas] PDF all error", err);
    toast("Error al generar el PDF: " + (err?.message || err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "⬇ PDF (todos los grados)";
  }
}

function addGradePage(doc, grade, students, editionName, addFooter) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;

  // Header
  doc.setFillColor(20, 35, 80);
  doc.rect(0, 0, pageW, 12, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(200, 210, 240);
  doc.text("FERIA STEAM · Seminario Diocesano Cristo Sacerdote", margin, 8);
  doc.text(editionName, pageW - margin, 8, { align: "right" });

  let y = 18;

  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30, 50, 100);
  doc.text(`Planilla de Notas — Grado ${grade}`, margin, y); y += 5.5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110, 120, 150);
  doc.text(`${students.length} estudiante${students.length !== 1 ? "s" : ""} · Generado: ${fmtDateLong()}`, margin, y);
  y += 4;
  doc.text("Ordenado alfabéticamente por apellido", margin, y);
  y += 6;

  const tableBody = students.map((s, i) => [
    i + 1,
    s.fullName,
    s.teamName,
    s.notaSustentacion != null ? fmtScore(s.notaSustentacion) : "—",
    s.notaFuncionalidad != null ? fmtScore(s.notaFuncionalidad) : "—",
    s.notaDecoracion != null ? fmtScore(s.notaDecoracion) : "—",
    s.notaCampo != null ? fmtScore(s.notaCampo) : "—",
    s.promedio != null ? fmtScore(s.promedio) : "—",
    s.nivel || "—",
    s.equivalencia != null ? String(s.equivalencia) : "—",
  ]);

  doc.autoTable({
    startY: y,
    head: [["#", "Nombre completo", "Equipo", "Sustent.", "Func.\nprot.", "Decor.\nprot.", "Pruebas\ncampo", "Prom.", "Nivel", "Equiv."]],
    body: tableBody,
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineColor: [180, 195, 230],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 50, 120],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      fontSize: 6.5,
    },
    alternateRowStyles: { fillColor: [240, 244, 255] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: "auto", fontStyle: "bold" },
      2: { cellWidth: 32 },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 16, halign: "center" },
      6: { cellWidth: 16, halign: "center" },
      7: { cellWidth: 14, halign: "center", fontStyle: "bold" },
      8: { cellWidth: 18, halign: "center" },
      9: { cellWidth: 14, halign: "center", fontStyle: "bold", textColor: [30, 50, 120] },
    },
    margin: { left: margin, right: margin },
    theme: "grid",
    didDrawPage: (data) => {
      // Re-draw header on new pages
      if (data.pageNumber > 1) {
        doc.setFillColor(20, 35, 80);
        doc.rect(0, 0, pageW, 12, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(200, 210, 240);
        doc.text("FERIA STEAM · Seminario Diocesano Cristo Sacerdote", margin, 8);
        doc.text(`Grado ${grade}`, pageW - margin, 8, { align: "right" });
      }
    },
  });

  // Espacio para firmas
  const finalY = doc.lastAutoTable.finalY + 15;
  const pageH = doc.internal.pageSize.getHeight();
  if (finalY < pageH - 30) {
    const lineW = 60;
    const gap = 30;
    const startX = (pageW - lineW * 2 - gap) / 2;
    doc.setDrawColor(150, 160, 190);
    doc.line(startX, finalY, startX + lineW, finalY);
    doc.line(startX + lineW + gap, finalY, startX + lineW * 2 + gap, finalY);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(110, 120, 150);
    doc.text("Firma docente", startX + lineW / 2, finalY + 4, { align: "center" });
    doc.text("Firma coordinador(a)", startX + lineW + gap + lineW / 2, finalY + 4, { align: "center" });
  }

  if (addFooter) addPdfFooter(doc);
}

function addPdfFooter(doc) {
  const pageW = doc.internal.pageSize.getWidth();
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFillColor(20, 35, 80);
    doc.rect(0, pageH - 10, pageW, 10, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(180, 195, 230);
    doc.text(`Feria STEAM · Planilla de notas · Pág ${i} / ${n}`, pageW / 2, pageH - 4, { align: "center" });
  }
}

// ─── Utilidades de UI ────────────────────────────────────────────
function metricCard(label, value) {
  return el("div", { class: "card metric" }, [
    el("div", { class: "metric__label", text: String(label) }),
    el("div", { class: "metric__value", text: String(value) }),
  ]);
}

function buildTable(headers, rows) {
  const th = (text) => el("th", {
    text,
    style: "text-align:left;padding:8px 10px;font-size:0.77rem;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap",
  });
  const td = (val) => el("td", {
    text: String(val ?? "—"),
    style: "padding:8px 10px;font-size:0.9rem;border-bottom:1px solid var(--color-border)",
  });
  const tbody = el("tbody", {});
  rows.forEach((row) => tbody.append(el("tr", {}, row.map(td))));
  return el("table", { style: "width:100%;border-collapse:collapse" }, [
    el("thead", {}, [el("tr", {}, headers.map(th))]),
    tbody,
  ]);
}
