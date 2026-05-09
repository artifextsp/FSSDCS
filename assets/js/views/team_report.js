import { el, clear, toast, fmtScore } from "../utils.js?v=19";
import { supabase } from "../supabase.js?v=19";
import { teamReportUnlock, searchTeamsByName, getActiveEdition } from "../data.js?v=19";
import { generateTeamPDF } from "./analytics.js?v=19";

/* ================================================================
   Página pública: "Mi informe de resultados"
   Cualquier persona con el nombre del equipo + código secreto
   puede descargar el PDF de desempeño de su equipo.
   Los jurados aparecen como "Jurado 1", "Jurado 2", etc.
   ================================================================ */

// Escala de equivalencia: leída del mismo localStorage que usa el admin
const SCALE_KEY = "feria-steam-grade-scale";
const DEFAULT_SCALE = [
  { min: 0,   max: 2.0, label: "Bajo",     equivalent: 2.0 },
  { min: 2.1, max: 3.0, label: "Básico",   equivalent: 3.0 },
  { min: 3.1, max: 3.9, label: "Alto",     equivalent: 3.9 },
  { min: 4.0, max: 4.5, label: "Alto",     equivalent: 4.5 },
  { min: 4.6, max: 5.0, label: "Superior", equivalent: 5.0 },
];
function loadScale() {
  try {
    const raw = localStorage.getItem(SCALE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return DEFAULT_SCALE.map((s) => ({ ...s }));
}

export async function renderTeamReport() {
  const main = document.querySelector("[data-app-main]");
  clear(main);

  const wrap = el("section", { class: "container" });
  main.append(wrap);

  // ── Encabezado ────────────────────────────────────────────────
  wrap.append(
    el("div", { class: "hero", style: { paddingTop: "var(--space-9)", paddingBottom: "var(--space-7)", textAlign: "center" } }, [
      el("h1", { class: "hero__title", style: { fontSize: "clamp(1.6rem, 4vw, 2.4rem)" }, text: "Descarga tu informe de resultados" }),
      el("p", { class: "hero__sub text-muted", style: { maxWidth: "560px", margin: "0 auto" } },
        ["Busca el nombre de tu equipo, selecciónalo e ingresa el ",
          el("strong", { text: "código secreto de 3 dígitos" }),
          " que te asignó tu institución para obtener tu informe en PDF."]),
    ])
  );

  // ── Carga la edición activa ───────────────────────────────────
  let activeEdition = null;
  try {
    activeEdition = await getActiveEdition();
  } catch { /* continúa sin edición, la búsqueda fallará con mensaje amigable */ }

  // ── Buscador de equipos ───────────────────────────────────────
  const searchInput = el("input", {
    class: "input",
    type: "search",
    placeholder: "Escribe el nombre de tu equipo…",
    style: { maxWidth: "480px", width: "100%", fontSize: "1rem" },
    autocomplete: "off",
    spellcheck: false,
  });

  const resultsBox = el("div", { style: { maxWidth: "480px", marginTop: "var(--space-3)" } });

  wrap.append(
    el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-6)" } }, [
      searchInput,
      resultsBox,
    ])
  );

  let searchTimer = null;
  let selectedTeam = null;

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { clear(resultsBox); return; }
    searchTimer = setTimeout(() => doSearch(q), 300);
  });

  async function doSearch(query) {
    clear(resultsBox);
    resultsBox.append(el("div", { class: "spinner", style: { margin: "16px auto" }, "aria-hidden": "true" }));

    try {
      if (!activeEdition) throw new Error("No hay una edición activa en este momento.");
      const teams = await searchTeamsByName(activeEdition.slug, query);
      clear(resultsBox);

      if (!teams.length) {
        resultsBox.append(
          el("p", { class: "text-muted", style: { textAlign: "center", padding: "var(--space-4)" }, text: "No encontramos equipos con ese nombre. Verifica la ortografía." })
        );
        return;
      }

      const list = el("div", {
        style: {
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)", overflow: "hidden",
        },
      });

      teams.forEach((t, i) => {
        const item = el("button", {
          style: {
            display: "block", width: "100%", textAlign: "left",
            padding: "var(--space-3) var(--space-4)",
            background: "transparent", border: "none",
            borderBottom: i < teams.length - 1 ? "1px solid var(--color-border)" : "none",
            cursor: "pointer", color: "var(--color-text)",
            transition: "background var(--duration-2)",
          },
          onclick: () => selectTeam(t),
        }, [
          el("p", { style: { fontWeight: 600, margin: 0 }, text: t.name }),
          el("p", { class: "text-muted", style: { fontSize: "0.82rem", margin: "2px 0 0" }, text: t.project?.name || "" }),
        ]);
        item.addEventListener("mouseover", () => item.style.background = "var(--color-surface-2)");
        item.addEventListener("mouseout", () => item.style.background = "transparent");
        list.append(item);
      });

      resultsBox.append(list);
    } catch (err) {
      clear(resultsBox);
      resultsBox.append(el("div", { class: "error-banner", text: err?.message || "Error al buscar equipos." }));
    }
  }

  // ── Panel de validación de código ─────────────────────────────
  const codePanel = el("div", {
    style: {
      maxWidth: "480px", width: "100%", marginTop: "var(--space-6)",
      display: "none",
    },
  });
  wrap.append(el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center" } }, [codePanel]));

  function selectTeam(team) {
    selectedTeam = team;
    clear(resultsBox);
    searchInput.value = team.name;

    // Mostrar panel de código
    clear(codePanel);
    codePanel.style.display = "block";

    const errEl = el("div", { class: "error-banner", style: { display: "none" } });
    const codeInput = el("input", {
      class: "input",
      type: "text",
      inputmode: "numeric",
      pattern: "[0-9]*",
      maxlength: 3,
      placeholder: "Código de 3 dígitos",
      style: { fontSize: "1.4rem", letterSpacing: "0.3em", textAlign: "center", fontWeight: 700 },
      autocomplete: "off",
    });

    const downloadBtn = el("button", {
      class: "btn btn--primary btn--lg btn--block",
      type: "submit",
      text: "Descargar mi informe (PDF)",
    });

    const form = el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        errEl.style.display = "none";
        const code = codeInput.value.trim();
        if (!code || code.length !== 3 || !/^\d{3}$/.test(code)) {
          errEl.textContent = "Ingresa un código de exactamente 3 dígitos.";
          errEl.style.display = "";
          return;
        }
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Validando código…";
        try {
          const result = await teamReportUnlock(selectedTeam.id, code);
          if (!result || result.error) {
            const msg = result?.error === "not_found"
              ? "Equipo no encontrado."
              : result?.error === "invalid_code"
                ? "Código incorrecto. Verifica el código que te asignaron."
                : "No se pudo validar el código.";
            errEl.textContent = msg;
            errEl.style.display = "";
            downloadBtn.disabled = false;
            downloadBtn.textContent = "Descargar mi informe (PDF)";
            return;
          }

          downloadBtn.textContent = "Preparando PDF…";
          const scale = loadScale();
          await generateTeamPDF({ btn: downloadBtn, rpcData: result, scale });
          downloadBtn.textContent = "Descargar mi informe (PDF)";
        } catch (err) {
          errEl.textContent = err?.message || "Ocurrió un error. Intenta de nuevo.";
          errEl.style.display = "";
          downloadBtn.disabled = false;
          downloadBtn.textContent = "Descargar mi informe (PDF)";
        }
      },
    }, [
      el("p", { style: { fontWeight: 600, marginBottom: "var(--space-2)" } }, [
        "Equipo seleccionado: ",
        el("span", { style: { color: "var(--color-primary)" }, text: team.name }),
      ]),
      el("p", { class: "text-muted", style: { fontSize: "0.85rem", marginBottom: "var(--space-4)" } },
        [team.project?.name || ""]),
      errEl,
      el("div", { class: "field" }, [
        el("label", { class: "field__label", text: "Código secreto del equipo" }),
        codeInput,
        el("span", { class: "field__hint", text: "El administrador de la feria te lo entregó." }),
      ]),
      downloadBtn,
      el("button", {
        class: "btn btn--ghost btn--block mt-3",
        type: "button",
        text: "← Buscar otro equipo",
        onclick: () => {
          codePanel.style.display = "none";
          selectedTeam = null;
          searchInput.value = "";
          searchInput.focus();
        },
      }),
    ]);

    codePanel.append(el("div", { class: "card" }, [form]));
    setTimeout(() => codeInput.focus(), 50);
  }
}
