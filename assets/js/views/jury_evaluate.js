import { clear, el, fmtScore, toast, confirmDialog } from "../utils.js?v=19";
import { getAuthSnapshot } from "../auth.js?v=19";
import {
  getProject,
  listTeamsByProject,
  listTeamMembers,
  getTeamFull,
  getMyEvaluatorIdForEdition,
  getOrCreateEvaluation,
  listAnswers,
  upsertAnswer,
  setEvaluationStatus,
  uploadTeamPhoto,
  deleteTeamPhoto,
  signedPhotoUrl,
  listConfigs,
  listMyEvaluationsForProjects,
} from "../data.js?v=19";

import { navigate } from "../router.js?v=19";
import { subscribeTable } from "../realtime.js?v=19";

/* ============ Pantalla 1: Lista de equipos del proyecto a evaluar ============ */
export async function renderJuryEvaluate(projectId) {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const auth = getAuthSnapshot();
  if (!auth.ready) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Verificando sesión…" }),
    ]));
    return;
  }
  if (!auth.session) { navigate("/jurado"); return; }

  wrap.append(el("a", { class: "btn btn--ghost btn--sm", href: "#/jurado", text: "← Volver a mis proyectos" }));

  let project, teams, configs;
  try {
    project = await getProject(projectId);
    teams = await listTeamsByProject(projectId);
    configs = await listConfigs(projectId);
  } catch (e) {
    wrap.append(el("div", { class: "error-banner mt-3", text: "Error cargando el proyecto." })); return;
  }
  if (!project) { wrap.append(el("div", { class: "empty mt-3", text: "Proyecto no encontrado." })); return; }

  wrap.append(el("h1", { class: "mt-3", text: project.name }));
  wrap.append(el("p", { class: "text-muted", text: project.grade_label ? `Grado: ${project.grade_label}` : "" }));

  if (!configs?.filter((c) => c.is_active).length) {
    wrap.append(el("div", { class: "empty mt-4", text: "El administrador aún no configuró la metodología de evaluación." }));
    return;
  }

  wrap.append(el("h2", { class: "mt-4", text: "Equipos a evaluar" }));
  wrap.append(el("p", { class: "text-muted", text: `Selecciona el equipo que vas a evaluar. Cada equipo se califica por separado.` }));

  if (!teams.length) {
    wrap.append(el("div", { class: "empty mt-4", text: "Este proyecto aún no tiene equipos registrados." }));
    return;
  }

  // Pre-cargo mis evaluaciones de este proyecto para pintar el estado por
  // equipo (Enviada / Borrador / Pendiente) y el total que le di a cada uno.
  const myEvals = await listMyEvaluationsForProjects([projectId]).catch(() => []);
  const evByTeam = {};
  myEvals.forEach((ev) => {
    if (!evByTeam[ev.team_id]) evByTeam[ev.team_id] = [];
    evByTeam[ev.team_id].push(ev);
  });

  const grid = el("div", { class: "grid grid--cards mt-3" });
  wrap.append(grid);
  for (const t of teams) {
    const memberCount = (await listTeamMembers(t.id).catch(() => [])).length;
    const evals = evByTeam[t.id] || [];
    const allSubmitted = evals.length > 0 && evals.every((e) => e.status === "submitted");
    const someDraft = evals.some((e) => e.status === "draft");
    const myTotal = evals.reduce((a, e) => a + (Number(e.total_score) || 0), 0);

    let statusPill;
    if (allSubmitted) statusPill = el("span", { class: "pill pill--accent", text: `Enviada · ${fmtScore(myTotal)}` });
    else if (someDraft) statusPill = el("span", { class: "pill pill--warning", text: `Borrador · ${fmtScore(myTotal)}` });
    else statusPill = el("span", { class: "pill", text: "Pendiente" });

    grid.append(el("a", { class: "project-card", href: `#/jurado/equipo/${t.id}` }, [
      el("div", { class: "project-card__cover project-card__cover--placeholder" }),
      el("div", { class: "project-card__title", text: t.name }),
      el("div", { class: "project-card__meta", text: [
        t.room && `Aula ${t.room}`,
        t.presentation_order != null && `Orden ${t.presentation_order}`,
        `${memberCount} integrante(s)`,
      ].filter(Boolean).join(" · ") || "—" }),
      el("div", { class: "flex items-center gap-2 mt-2" }, [statusPill]),
      el("div", { class: "btn btn--primary btn--sm mt-2", text: allSubmitted ? "Ver evaluación" : "Evaluar →" }),
    ]));
  }
}

/* ============ Pantalla 2: Evaluación del equipo ============ */
export async function renderJuryTeamEvaluate(teamId) {
  const main = document.querySelector("[data-app-main]");
  clear(main);
  const wrap = el("section", { class: "container" });
  main.append(wrap);

  const auth = getAuthSnapshot();
  if (!auth.ready) {
    wrap.append(el("div", { class: "loading-screen" }, [
      el("div", { class: "spinner", "aria-hidden": "true" }),
      el("p", { text: "Verificando sesión…" }),
    ]));
    return;
  }
  if (!auth.session) { navigate("/jurado"); return; }

  let bundle;
  try { bundle = await getTeamFull(teamId); }
  catch (e) {
    wrap.append(el("div", { class: "error-banner", text: "Error cargando el equipo." })); return;
  }
  if (!bundle?.team) { wrap.append(el("div", { class: "empty", text: "Equipo no encontrado." })); return; }
  const { team, project, configs, photos } = bundle;

  wrap.append(el("a", { class: "btn btn--ghost btn--sm", href: `#/jurado/proyecto/${project.id}`, text: `← ${project.name}` }));
  wrap.append(el("div", { class: "section-head", style: { marginTop: "var(--space-3)" } }, [
    el("div", {}, [
      el("h1", { text: team.name }),
      el("p", { class: "text-muted", text: [
        project.name,
        team.room && `Aula ${team.room}`,
        team.presentation_order != null && `Orden ${team.presentation_order}`,
      ].filter(Boolean).join(" · ") }),
    ]),
  ]));

  let evaluatorId;
  try { evaluatorId = await getMyEvaluatorIdForEdition(project.edition_id); } catch (e) {}
  if (!evaluatorId) {
    wrap.append(el("div", { class: "error-banner", text: "Tu cuenta no está asignada como jurado de esta edición." }));
    return;
  }

  const tabs = el("div", { class: "tabs" });
  const panels = el("div");
  wrap.append(tabs, panels);

  const photosCard = el("div", { class: "card mt-5" }, [
    el("h3", { class: "card__title", text: "Fotos del equipo" }),
  ]);
  wrap.append(photosCard);

  const phases = configs.length ? configs : [];
  if (!phases.length) {
    panels.append(el("div", { class: "empty", text: "El administrador aún no configura la evaluación de este proyecto." }));
  } else {
    phases.forEach((cfg, idx) => {
      tabs.append(el("button", {
        class: `tabs__btn ${idx === 0 ? "is-active" : ""}`,
        text: phaseLabel(cfg.phase),
        onclick: () => activate(idx),
      }));
    });
    phases.forEach((cfg, idx) => {
      const panel = el("div", { class: idx === 0 ? "" : "visually-hidden" });
      panels.append(panel);
      mountConfigForm(panel, cfg, { team, project, evaluatorId });
    });
    function activate(i) {
      Array.from(tabs.children).forEach((c, ci) => c.classList.toggle("is-active", ci === i));
      Array.from(panels.children).forEach((c, ci) => c.classList.toggle("visually-hidden", ci !== i));
    }
  }

  await mountPhotosBlock(photosCard, team, photos);
}

/* ---------------- Form per config ---------------- */
async function mountConfigForm(root, cfg, { team, project, evaluatorId }) {
  const head = el("div", { class: "flex items-center gap-2 mb-3" }, [
    el("span", { class: "pill", text: methodLabel(cfg.method_type) }),
    el("span", { class: "text-muted", text: `Escala: ${cfg.scale_min}–${cfg.scale_max}` }),
  ]);
  root.append(head);

  let evaluation;
  try {
    evaluation = await getOrCreateEvaluation({
      teamId: team.id,
      evaluatorId,
      configId: cfg.id,
      phase: cfg.phase,
    });
  } catch (e) {
    root.append(el("div", { class: "error-banner", text: "No se pudo iniciar la evaluación: " + (e?.message || "") }));
    return;
  }
  let answers = await listAnswers(evaluation.id).catch(() => []);
  const totalEl = el("span", { class: "pill pill--accent", text: `Total: ${fmtScore(evaluation.total_score ?? 0)}` });
  head.append(totalEl);
  head.append(statusPill(evaluation.status));

  // Aviso de bloqueo cuando la evaluación ya fue enviada. El admin tiene que
  // reabrirla desde el panel para que el jurado pueda volver a editar.
  const lockedBanner = el("div", { class: "info-banner", text: "Esta evaluación ya fue enviada y está bloqueada. Si necesitas corregirla, pídele al administrador que la reabra desde el panel.", style: { display: evaluation.status === "submitted" ? "block" : "none" } });
  root.append(lockedBanner);

  const items = buildItems(cfg);
  const form = el("div", { class: "flex-col gap-3" });
  root.append(form);

  const finalItems = applyRandomPick(cfg, items, answers);

  const isLocked = () => evaluation.status === "submitted";

  finalItems.forEach((it) => form.append(itemRow(it, {
    cfg,
    answer: answers.find((a) => a.item_key === it.item_key) || null,
    isLocked,
    onChange: async (patch) => {
      if (isLocked()) {
        toast("La evaluación está enviada y bloqueada", "warning");
        return;
      }
      try {
        const saved = await upsertAnswer({
          evaluationId: evaluation.id,
          itemKey: it.item_key,
          score: patch.score,
          observation: patch.observation,
          meta: patch.meta || {},
        });
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
      if (isLocked()) return;
      try { evaluation = await setEvaluationStatus(evaluation.id, evaluation.status, e.target.value); }
      catch (err) { toast("No se pudo guardar la nota", "error"); }
    },
  });

  const draftBtn = el("button", { class: "btn btn--ghost", text: "Guardar borrador", onclick: async () => {
    try { evaluation = await setEvaluationStatus(evaluation.id, "draft"); paintStatus(); toast("Borrador guardado", "success"); }
    catch (e) { toast("No se pudo guardar", "error"); }
  } });
  const sendBtn = el("button", { class: "btn btn--primary", text: "Enviar evaluación", onclick: async () => {
    const ok = await confirmDialog("Al enviar, tu evaluación contará para el ranking y NO podrás modificarla. Solo el admin puede reabrirla. ¿Confirmar?", { okLabel: "Enviar" });
    if (!ok) return;
    try {
      evaluation = await setEvaluationStatus(evaluation.id, "submitted", notes.value);
      paintStatus();
      toast("Evaluación enviada", "success");
    } catch (e) { toast("No se pudo enviar: " + (e.message || ""), "error"); }
  } });
  const actions = el("div", { class: "btn-row mt-4" }, [draftBtn, sendBtn]);
  root.append(notes, actions);

  applyLockUI();

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
  root._cleanup = () => unsub?.();

  function paintStatus() {
    totalEl.textContent = `Total: ${fmtScore(evaluation.total_score ?? 0)}`;
    const oldPill = head.querySelector("[data-status-pill]");
    if (oldPill) oldPill.remove();
    head.append(statusPill(evaluation.status));
    applyLockUI();
  }

  // Aplica el bloqueo visual (form deshabilitado + banner) según el estado
  // actual de la evaluación.
  function applyLockUI() {
    const locked = evaluation.status === "submitted";
    lockedBanner.style.display = locked ? "block" : "none";
    notes.disabled = locked;
    sendBtn.disabled = locked;
    draftBtn.style.display = locked ? "none" : "";
    sendBtn.style.display = locked ? "none" : "";
    form.querySelectorAll("button.score-input__btn, input.input, textarea")
      .forEach((node) => { node.disabled = locked; });
    form.classList.toggle("is-locked", locked);
  }
}

function statusPill(s) {
  const cls = s === "submitted" ? "pill--accent" : "pill--warning";
  const text = s === "submitted" ? "Enviada" : "Borrador";
  const node = el("span", { class: `pill ${cls}`, text });
  node.dataset.statusPill = "1";
  return node;
}

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

function applyRandomPick(cfg, items, answers) {
  const pickCount =
    cfg.method_type === "questionnaire" ? Number(cfg.config?.randomPickCount || 0) :
    cfg.method_type === "questionnaire_interview" ? Number(cfg.config?.questionnaire?.randomPickCount || 0) : 0;
  if (!pickCount) return items;

  const isQ = (it) => it.item_key.startsWith("q:");
  const qItems = items.filter(isQ);
  const otherItems = items.filter((x) => !isQ(x));

  const answeredKeys = new Set(answers.map((a) => a.item_key).filter((k) => k.startsWith("q:")));
  let chosen;
  if (answeredKeys.size) {
    chosen = qItems.filter((it) => answeredKeys.has(it.item_key));
    if (chosen.length < pickCount) {
      const pool = qItems.filter((it) => !answeredKeys.has(it.item_key));
      shuffle(pool);
      chosen = chosen.concat(pool.slice(0, pickCount - chosen.length));
    } else { chosen = chosen.slice(0, pickCount); }
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

function itemRow(item, { cfg, answer, onChange, isLocked }) {
  const lockedFn = typeof isLocked === "function" ? isLocked : () => false;
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
  if (max - min > 10) {
    const num = el("input", {
      class: "input", type: "number", min, max, step: "0.5",
      value: currentScore ?? "",
      placeholder: `Puntaje (${min}–${max})`,
      oninput: () => { const v = clampNum(num.value, min, max); if (v !== null) currentScore = v; },
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
          if (lockedFn()) return;
          currentScore = v;
          buttons.forEach((bb) => bb.classList.toggle("is-active", Number(bb.textContent) === v));
          onChange({ score: currentScore, observation: currentObs });
        },
      });
      if (currentScore === v) b.classList.add("is-active");
      if (lockedFn()) b.disabled = true;
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
  return ({ questionnaire: "Pregunta", interview: "Entrevista", phase: "Fase", round: "Ronda", modality: "Modalidad" })[t] || t;
}
function methodLabel(m) {
  return ({
    questionnaire: "Cuestionario", interview: "Entrevista",
    questionnaire_interview: "Cuestionario + Entrevista",
    process_phases: "Fases del proceso", process_phases_interview: "Fases + Entrevista",
    field_rounds: "Rondas de concurso",
  })[m] || m;
}
function phaseLabel(p) { return p === "sustentation" ? "Sustentación" : p === "field_contest" ? "Concurso de campo" : p; }
function clampNum(v, min, max) {
  const n = Number(v); if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}
function formatSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/* ---------------- Photos block (por equipo) ---------------- */
async function mountPhotosBlock(card, team, initialPhotos) {
  const grid = el("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" } });
  card.append(grid);

  let photos = [...(initialPhotos || [])];

  async function paint() {
    clear(grid);
    if (!photos.length) {
      grid.append(el("div", { class: "empty", style: { gridColumn: "1/-1" }, text: "Aún no hay fotos." }));
    } else {
      for (const p of photos) {
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
            try { await deleteTeamPhoto(p); photos = photos.filter((x) => x.id !== p.id); paint(); toast("Foto eliminada", "success"); }
            catch (e) { toast("No se pudo eliminar", "error"); }
          },
        });
        box.append(del);
        grid.append(box);
      }
    }
  }

  // Dos inputs separados: uno para abrir cámara directo y otro para galería.
  // El primero usa capture=environment; el segundo no (deja escoger).
  const fileInputCam = el("input", { type: "file", accept: "image/*", capture: "environment", style: { display: "none" } });
  const fileInputLib = el("input", { type: "file", accept: "image/*", style: { display: "none" } });

  const uploadBtn = el("button", { class: "btn btn--primary mt-3", text: "📷 Tomar foto", onclick: () => fileInputCam.click() });
  const galleryBtn = el("button", { class: "btn btn--ghost mt-3", text: "🖼️ Subir desde galería", onclick: () => fileInputLib.click() });
  const progressEl = el("div", { class: "text-muted mt-2", style: { display: "none", fontSize: "0.85rem" } });

  async function handleFile(file) {
    if (!file) return;
    // Feedback inmediato: deshabilitamos los botones y mostramos progreso.
    uploadBtn.disabled = true;
    galleryBtn.disabled = true;
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = "Procesando foto…";
    progressEl.style.display = "block";
    progressEl.textContent = "Comprimiendo imagen para que cargue rápido…";
    // Damos un microtick para que el navegador pinte el estado deshabilitado
    // antes de empezar el trabajo pesado.
    await new Promise((r) => requestAnimationFrame(() => r()));
    try {
      progressEl.textContent = `Subiendo foto (${formatSize(file.size)} aprox.)…`;
      const ph = await uploadTeamPhoto({ teamId: team.id, file });
      photos.push(ph);
      await paint();
      toast("Foto subida", "success");
    } catch (e) {
      console.error("[upload photo]", e);
      toast("No se pudo subir: " + (e?.message || "Error desconocido"), "error", 6000);
    } finally {
      uploadBtn.disabled = false;
      galleryBtn.disabled = false;
      uploadBtn.textContent = originalText;
      progressEl.style.display = "none";
      progressEl.textContent = "";
      fileInputCam.value = "";
      fileInputLib.value = "";
    }
  }
  fileInputCam.addEventListener("change", () => handleFile(fileInputCam.files?.[0]));
  fileInputLib.addEventListener("change", () => handleFile(fileInputLib.files?.[0]));
  card.append(
    el("div", { class: "btn-row mt-3" }, [uploadBtn, galleryBtn]),
    progressEl,
    fileInputCam,
    fileInputLib,
  );

  await paint();

  subscribeTable({
    table: "team_photos",
    filter: `team_id=eq.${team.id}`,
    onChange: async () => {
      try {
        const fresh = await getTeamFull(team.id);
        photos = fresh.photos || [];
        paint();
      } catch {}
    },
  });
}
