import { clear, el, fmtScore, toast, confirmDialog } from "../utils.js";
import { getAuthSnapshot } from "../auth.js";
import {
  getProjectFull,
  getMyEvaluatorIdForEdition,
  getOrCreateEvaluation,
  listAnswers,
  upsertAnswer,
  setEvaluationStatus,
  uploadProjectPhoto,
  deleteProjectPhoto,
  signedPhotoUrl,
} from "../data.js";

import { navigate } from "../router.js";
import { subscribeTable } from "../realtime.js";

export async function renderJuryEvaluate(projectId) {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const auth = getAuthSnapshot();
  if (!auth.session) { navigate("/jurado"); return; }

  wrap.append(el("a", { class: "btn btn--ghost btn--sm", href: "#/jurado", text: "← Volver" }));
  const status = el("p", { class: "text-muted mt-3", text: "Cargando proyecto…" });
  wrap.append(status);

  let bundle;
  try { bundle = await getProjectFull(projectId); }
  catch (e) { status.textContent = "Error cargando el proyecto."; return; }
  if (!bundle?.project) { status.textContent = "Proyecto no encontrado."; return; }
  const { project, configs, photos } = bundle;
  clear(wrap);
  wrap.append(el("a", { class: "btn btn--ghost btn--sm", href: "#/jurado", text: "← Volver" }));

  wrap.append(el("div", { class: "section-head", style: { marginTop: "var(--space-3)" } }, [
    el("div", {}, [
      el("h1", { text: project.name }),
      el("p", { class: "text-muted", text: [project.grade_label, project.room].filter(Boolean).join(" · ") || "—" }),
    ]),
  ]));

  let evaluatorId;
  try { evaluatorId = await getMyEvaluatorIdForEdition(project.edition_id); }
  catch (e) {}
  if (!evaluatorId) {
    wrap.append(el("div", { class: "error-banner", text: "Tu cuenta no está registrada como jurado de esta edición." }));
    return;
  }

  // Tabs por fase (sustentation / field_contest)
  const tabs = el("div", { class: "tabs" });
  const panels = el("div");
  wrap.append(tabs, panels);

  const photosCard = el("div", { class: "card mt-5" }, [
    el("h3", { class: "card__title", text: "Fotos del proyecto" }),
  ]);
  wrap.append(photosCard);

  const phases = configs.length ? configs : [];
  if (!phases.length) {
    panels.append(el("div", { class: "empty", text: "El administrador aún no configura la evaluación de este proyecto." }));
  } else {
    phases.forEach((cfg, idx) => {
      const btn = el("button", {
        class: `tabs__btn ${idx === 0 ? "is-active" : ""}`,
        text: phaseLabel(cfg.phase),
        onclick: () => activate(idx),
      });
      tabs.append(btn);
    });
    phases.forEach((cfg, idx) => {
      const panel = el("div", { class: idx === 0 ? "" : "visually-hidden" });
      panels.append(panel);
      mountConfigForm(panel, cfg, { project, evaluatorId });
    });
    function activate(i) {
      Array.from(tabs.children).forEach((c, ci) => c.classList.toggle("is-active", ci === i));
      Array.from(panels.children).forEach((c, ci) => c.classList.toggle("visually-hidden", ci !== i));
    }
  }

  await mountPhotosBlock(photosCard, project, photos);
}

/* ---------------- Form per config ---------------- */
async function mountConfigForm(root, cfg, { project, evaluatorId }) {
  const head = el("div", { class: "flex items-center gap-2 mb-3" }, [
    el("span", { class: "pill", text: methodLabel(cfg.method_type) }),
    el("span", { class: "text-muted", text: `Escala: ${cfg.scale_min}–${cfg.scale_max}` }),
  ]);
  root.append(head);

  let evaluation;
  try {
    evaluation = await getOrCreateEvaluation({
      projectId: project.id,
      evaluatorId,
      configId: cfg.id,
      phase: cfg.phase,
    });
  } catch (e) {
    root.append(el("div", { class: "error-banner", text: "No se pudo iniciar la evaluación." }));
    return;
  }
  let answers = await listAnswers(evaluation.id).catch(() => []);
  const totalEl = el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(evaluation.total_score ?? 0)}` });
  head.append(totalEl);
  head.append(statusPill(evaluation.status));

  const items = buildItems(cfg);
  const form = el("div", { class: "flex-col gap-3" });
  root.append(form);

  // Preguntas con randomPickCount
  const finalItems = applyRandomPick(cfg, items, answers);

  finalItems.forEach((it) => form.append(itemRow(it, {
    cfg,
    answer: answers.find((a) => a.item_key === it.item_key) || null,
    onChange: async (patch) => {
      try {
        const saved = await upsertAnswer({
          evaluationId: evaluation.id,
          itemKey: it.item_key,
          score: patch.score,
          observation: patch.observation,
          meta: patch.meta || {},
        });
        // Update local state
        const i = answers.findIndex((a) => a.item_key === it.item_key);
        if (i >= 0) answers[i] = saved; else answers.push(saved);
        toast("Guardado", "success", 1200);
      } catch (e) {
        toast("Error guardando: " + (e.message || ""), "error");
      }
    },
  })));

  const notes = el("textarea", {
    class: "textarea mt-3",
    placeholder: "Observaciones generales (opcional)",
    value: evaluation.notes || "",
    onblur: async (e) => {
      try {
        evaluation = await setEvaluationStatus(evaluation.id, evaluation.status, e.target.value);
      } catch (err) { toast("No se pudo guardar la nota", "error"); }
    },
  });

  const actions = el("div", { class: "btn-row mt-4" }, [
    el("button", { class: "btn btn--ghost", text: "Guardar borrador", onclick: async () => {
      try { evaluation = await setEvaluationStatus(evaluation.id, "draft"); paintStatus(); toast("Borrador guardado", "success"); }
      catch (e) { toast("No se pudo guardar", "error"); }
    } }),
    el("button", { class: "btn btn--primary", text: "Enviar evaluación", onclick: async () => {
      const ok = await confirmDialog("Al enviar, tu evaluación contará para el ranking. ¿Confirmar?", { okLabel: "Enviar" });
      if (!ok) return;
      try {
        evaluation = await setEvaluationStatus(evaluation.id, "submitted", notes.value);
        paintStatus();
        toast("Evaluación enviada", "success");
      } catch (e) { toast("No se pudo enviar: " + (e.message || ""), "error"); }
    } }),
  ]);
  root.append(notes, actions);

  // Subscribe to score updates to keep total live
  const unsub = subscribeTable({
    table: "evaluations",
    filter: `id=eq.${evaluation.id}`,
    onChange: (payload) => {
      const fresh = payload.new || payload.old;
      if (!fresh) return;
      evaluation = fresh;
      paintStatus();
    },
  });
  root.dataset.cleanup = "1";
  root._cleanup = () => unsub?.();

  function paintStatus() {
    totalEl.textContent = `Total: ${fmtScore(evaluation.total_score ?? 0)}`;
    const oldPill = head.querySelector("[data-status-pill]");
    if (oldPill) oldPill.remove();
    head.append(statusPill(evaluation.status));
  }
}

function statusPill(s) {
  const cls = s === "submitted" ? "pill--accent" : "pill--warning";
  const text = s === "submitted" ? "Enviada" : "Borrador";
  const node = el("span", { class: `pill ${cls}`, text });
  node.dataset.statusPill = "1";
  return node;
}

/* ---------------- Build items per method_type ---------------- */
function buildItems(cfg) {
  const m = cfg.method_type;
  const c = cfg.config || {};
  if (m === "questionnaire") return (c.questions || []).map((q) => ({
    type: "questionnaire", item_key: `q:${q.id}`, prompt: q.prompt, requiresObservation: !!q.requiresObservation,
    maxScore: clampMax(q.maxScore, cfg),
  }));
  if (m === "interview") return (c.questions || []).map((q) => ({
    type: "interview", item_key: `iv:${q.id}`, prompt: q.prompt, requiresObservation: q.requiresObservation !== false,
    maxScore: clampMax(q.maxScore, cfg),
  }));
  if (m === "questionnaire_interview") {
    const a = (c.questionnaire?.questions || []).map((q) => ({
      type: "questionnaire", item_key: `q:${q.id}`, prompt: q.prompt, requiresObservation: !!q.requiresObservation,
      maxScore: clampMax(q.maxScore, cfg),
    }));
    const b = (c.interview?.questions || []).map((q) => ({
      type: "interview", item_key: `iv:${q.id}`, prompt: q.prompt, requiresObservation: q.requiresObservation !== false,
      maxScore: clampMax(q.maxScore, cfg),
    }));
    return [...a, ...b];
  }
  if (m === "process_phases") return (c.phases || []).map((p) => ({
    type: "phase", item_key: `ph:${p.id}`, prompt: p.label, requiresObservation: !!p.requiresObservation,
    maxScore: clampMax(p.maxScore, cfg),
  }));
  if (m === "process_phases_interview") {
    const a = (c.phases || []).map((p) => ({
      type: "phase", item_key: `ph:${p.id}`, prompt: p.label, requiresObservation: !!p.requiresObservation,
      maxScore: clampMax(p.maxScore, cfg),
    }));
    const b = (c.interview?.questions || []).map((q) => ({
      type: "interview", item_key: `iv:${q.id}`, prompt: q.prompt, requiresObservation: q.requiresObservation !== false,
      maxScore: clampMax(q.maxScore, cfg),
    }));
    return [...a, ...b];
  }
  if (m === "field_rounds") {
    const items = [];
    (c.rounds || []).forEach((r) => {
      items.push({
        type: "round", item_key: `rnd:${r.id}`, prompt: `${r.title} ${r.description ? "— " + r.description : ""}`.trim(),
        requiresObservation: false, maxScore: clampMax(r.maxScore, cfg),
      });
      (r.modalities || []).forEach((mod) => {
        items.push({
          type: "modality", item_key: `mod:${r.id}:${mod.id}`, prompt: `${r.title} · ${mod.label}`,
          requiresObservation: !!mod.requiresObservation, maxScore: clampMax(mod.maxScore, cfg),
        });
      });
    });
    return items;
  }
  return [];
}

function clampMax(maxScore, cfg) {
  const v = Number(maxScore);
  if (!Number.isFinite(v)) return cfg.scale_max;
  return Math.min(Math.max(v, cfg.scale_min), cfg.scale_max);
}

/**
 * Si method_type=questionnaire y config.questionnaire?.randomPickCount > 0, fija una selección
 * estable por evaluación basada en respuestas existentes; si aún no hay, elige aleatoriamente.
 */
function applyRandomPick(cfg, items, answers) {
  const pickCount =
    cfg.method_type === "questionnaire" ? Number(cfg.config?.randomPickCount || 0) :
    cfg.method_type === "questionnaire_interview" ? Number(cfg.config?.questionnaire?.randomPickCount || 0) : 0;
  if (!pickCount) return items;

  const isQ = (it) => it.item_key.startsWith("q:");
  const qItems = items.filter(isQ);
  const otherItems = items.filter((x) => !isQ(x));

  const answeredKeys = new Set(answers.map((a) => a.item_key).filter((k) => k.startsWith("q:")));
  // If we already have answers for some, keep those; otherwise pick at random
  let chosen;
  if (answeredKeys.size) {
    chosen = qItems.filter((it) => answeredKeys.has(it.item_key));
    // pad if fewer than pickCount
    if (chosen.length < pickCount) {
      const pool = qItems.filter((it) => !answeredKeys.has(it.item_key));
      shuffle(pool);
      chosen = chosen.concat(pool.slice(0, pickCount - chosen.length));
    } else {
      chosen = chosen.slice(0, pickCount);
    }
  } else {
    const pool = [...qItems];
    shuffle(pool);
    chosen = pool.slice(0, Math.min(pickCount, pool.length));
  }
  return [...chosen, ...otherItems];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ---------------- Item row ---------------- */
function itemRow(item, { cfg, answer, onChange }) {
  const card = el("div", { class: "card card--pad-sm flex-col gap-3" });
  card.append(el("div", { class: "flex items-center gap-2" }, [
    el("span", { class: "pill", text: typeLabel(item.type) }),
    el("span", { class: "text-muted", text: `Hasta ${item.maxScore} pts` }),
  ]));
  card.append(el("div", { style: { fontWeight: 600 }, text: item.prompt || "—" }));

  let currentScore = answer?.score ?? null;
  let currentObs = answer?.observation ?? "";

  const min = cfg.scale_min ?? 0;
  const max = item.maxScore ?? cfg.scale_max ?? 5;
  const scoreInput = el("div", { class: "score-input" });
  const buttons = [];
  // Para escalas grandes (>10), usar input numérico + slider
  if (max - min > 10) {
    const num = el("input", {
      class: "input", type: "number", min, max, step: "0.5",
      value: currentScore ?? "",
      placeholder: `Puntaje (${min}–${max})`,
      oninput: () => {
        const v = clampNum(num.value, min, max);
        if (v !== null) currentScore = v;
      },
      onchange: () => onChange({ score: currentScore, observation: currentObs }),
    });
    scoreInput.append(num);
  } else {
    for (let v = min; v <= max; v++) {
      const b = el("button", {
        class: "score-input__btn",
        type: "button",
        text: String(v),
        onclick: () => {
          currentScore = v;
          buttons.forEach((bb) => bb.classList.toggle("is-active", Number(bb.textContent) === v));
          onChange({ score: currentScore, observation: currentObs });
        },
      });
      if (currentScore === v) b.classList.add("is-active");
      buttons.push(b);
      scoreInput.append(b);
    }
  }
  card.append(scoreInput);

  if (item.requiresObservation || item.type === "interview" || item.type === "phase") {
    const ta = el("textarea", {
      class: "textarea",
      placeholder: "Observación / sustento de la calificación",
      value: currentObs,
      onblur: (e) => { currentObs = e.target.value; onChange({ score: currentScore, observation: currentObs }); },
    });
    card.append(ta);
  }
  return card;
}

function typeLabel(t) {
  return ({
    questionnaire: "Pregunta", interview: "Entrevista", phase: "Fase",
    round: "Ronda", modality: "Modalidad",
  })[t] || t;
}
function methodLabel(m) {
  return ({
    questionnaire: "Cuestionario", interview: "Entrevista",
    questionnaire_interview: "Cuestionario + Entrevista",
    process_phases: "Fases del proceso",
    process_phases_interview: "Fases + Entrevista",
    field_rounds: "Rondas de concurso",
  })[m] || m;
}
function phaseLabel(p) {
  return p === "sustentation" ? "Sustentación" : p === "field_contest" ? "Concurso de campo" : p;
}
function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

/* ---------------- Photos block ---------------- */
async function mountPhotosBlock(card, project, photos) {
  const grid = el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" } });
  card.append(grid);

  async function paint(list) {
    clear(grid);
    if (!list.length) {
      grid.append(el("div", { class: "empty", style: { gridColumn: "1/-1" }, text: "Aún no hay fotos." }));
    } else {
      for (const p of list) {
        const url = await signedPhotoUrl(p.storage_path).catch(() => null);
        const box = el("div", { style: { position: "relative", aspectRatio: "1/1", borderRadius: "12px", overflow: "hidden", background: "#000" } });
        if (url) box.append(el("img", { src: url, alt: "", loading: "lazy", style: { width: "100%", height: "100%", objectFit: "cover" } }));
        const del = el("button", {
          class: "btn btn--danger btn--sm",
          style: { position: "absolute", right: "6px", top: "6px" },
          text: "✕",
          onclick: async () => {
            const ok = await confirmDialog("¿Eliminar esta foto?", { okLabel: "Eliminar", danger: true });
            if (!ok) return;
            try { await deleteProjectPhoto(p); toast("Foto eliminada", "success"); refresh(); }
            catch (e) { toast("No se pudo eliminar", "error"); }
          },
        });
        box.append(del);
        grid.append(box);
      }
    }
  }

  const fileInput = el("input", { type: "file", accept: "image/*", capture: "environment", style: { display: "none" } });
  const uploadBtn = el("button", { class: "btn btn--primary mt-3", text: "📷 Tomar / subir foto", onclick: () => fileInput.click() });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try {
      await uploadProjectPhoto({ projectId: project.id, file });
      toast("Foto subida", "success");
      refresh();
    } catch (e) { toast("No se pudo subir: " + (e.message || ""), "error"); }
    finally { fileInput.value = ""; }
  });
  card.append(uploadBtn, fileInput);

  await paint(photos);

  let cur = photos;
  async function refresh() {
    try {
      const fresh = await getProjectFull(project.id);
      cur = fresh.photos || [];
      await paint(cur);
    } catch {}
  }
  // Realtime
  subscribeTable({
    table: "project_photos",
    filter: `project_id=eq.${project.id}`,
    onChange: refresh,
  });
}
