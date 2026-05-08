import { supabase } from "./supabase.js?v=17";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=17";

/* ---------------- Editions ---------------- */
export async function listEditionsAccessible() {
  const { data, error } = await supabase
    .from("editions")
    .select("*")
    .order("year", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getActiveEdition() {
  const { data, error } = await supabase
    .from("editions")
    .select("*")
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getEditionBySlug(slug) {
  const { data, error } = await supabase.from("editions").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function createEdition(payload) {
  const { data, error } = await supabase.from("editions").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
export async function updateEdition(id, patch) {
  const { data, error } = await supabase.from("editions").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

/* ---------------- Projects ---------------- */
export async function listProjects(editionId) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("edition_id", editionId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getProject(id) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function createProject(payload) {
  const { data, error } = await supabase.from("projects").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}
export async function updateProject(id, patch) {
  const { data, error } = await supabase.from("projects").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
export async function deleteProject(id) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Carga proyecto con equipos, configs, documentos y agregados de equipos.
 */
export async function getProjectFull(id) {
  const project = await getProject(id);
  if (!project) return null;
  const [teamsRes, docsRes, configsRes, scoresRes] = await Promise.all([
    supabase.from("teams").select("*").eq("project_id", id)
      .order("presentation_order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    supabase.from("project_documents").select("*").eq("project_id", id).order("sort_order", { ascending: true }),
    supabase.from("evaluation_configs").select("*").eq("project_id", id).eq("is_active", true),
    supabase.from("team_score_cache").select("*").eq("project_id", id),
  ]);
  if (teamsRes.error) throw teamsRes.error;
  return {
    project,
    teams: teamsRes.data ?? [],
    docs: docsRes.data ?? [],
    configs: configsRes.data ?? [],
    scores: scoresRes.data ?? [],
  };
}

/* ---------------- Teams ---------------- */
export async function listTeamsByProject(projectId) {
  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .eq("project_id", projectId)
    .order("presentation_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getTeam(id) {
  const { data, error } = await supabase.from("teams").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getTeamFull(id) {
  const team = await getTeam(id);
  if (!team) return null;
  const project = await getProject(team.project_id);
  const [membersRes, photosRes, scoreRes, configsRes, docsRes] = await Promise.all([
    supabase.from("team_members").select("*").eq("team_id", id).order("sort_order", { ascending: true }),
    supabase.from("team_photos").select("*").eq("team_id", id).order("created_at", { ascending: true }),
    supabase.from("team_score_cache").select("*").eq("team_id", id).maybeSingle(),
    supabase.from("evaluation_configs").select("*").eq("project_id", team.project_id).eq("is_active", true),
    supabase.from("project_documents").select("*").eq("project_id", team.project_id).order("sort_order", { ascending: true }),
  ]);
  return {
    team,
    project,
    members: membersRes.data ?? [],
    photos: photosRes.data ?? [],
    score: scoreRes.data ?? null,
    configs: configsRes.data ?? [],
    docs: docsRes.data ?? [],
  };
}

export async function createTeam({ projectId, name, room, presentationOrder, gradeLabel, description }) {
  const payload = {
    project_id: projectId,
    name: (name || "").trim(),
    room: room?.trim() || null,
    presentation_order: presentationOrder != null && presentationOrder !== "" ? Number(presentationOrder) : null,
    grade_label: gradeLabel?.trim() || null,
    description: description?.trim() || null,
  };
  const { data, error } = await supabase.from("teams").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateTeam(id, patch) {
  const norm = { ...patch };
  if (norm.presentation_order === "" || norm.presentation_order == null) norm.presentation_order = null;
  const { data, error } = await supabase.from("teams").update(norm).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteTeam(id) {
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- Team members ---------------- */
export async function listTeamMembers(teamId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function replaceTeamMembers(teamId, members) {
  const { error: delErr } = await supabase.from("team_members").delete().eq("team_id", teamId);
  if (delErr) throw delErr;
  if (!members?.length) return [];
  const rows = members.map((m, i) => ({
    team_id: teamId,
    full_name: m.full_name,
    sort_order: m.sort_order ?? i,
  }));
  const { data, error } = await supabase.from("team_members").insert(rows).select("*");
  if (error) throw error;
  return data;
}

/* ---------------- Ranking ---------------- */
export async function listRanking(editionId) {
  const { data, error } = await supabase
    .from("public_team_rankings")
    .select("*")
    .eq("edition_id", editionId)
    .order("edition_rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function listProjectRanking(projectId) {
  const { data, error } = await supabase
    .from("public_team_rankings")
    .select("*")
    .eq("project_id", projectId)
    .order("project_rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ---------------- Team portal ---------------- */
export async function teamPortalLookup(slug, name) {
  const { data, error } = await supabase.rpc("team_portal_lookup", { p_edition_slug: slug, p_team_name: name });
  if (error) throw error;
  return data;
}

export async function searchTeamsByName(editionSlug, query) {
  if (!editionSlug || !query || query.trim().length < 2) return [];
  const { data: edition, error: edErr } = await supabase
    .from("editions")
    .select("id")
    .eq("slug", editionSlug.trim())
    .maybeSingle();
  if (edErr || !edition) return [];
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, project:projects(name)")
    .eq("edition_id", edition.id)
    .ilike("name", `%${query.trim()}%`)
    .order("name", { ascending: true })
    .limit(10);
  if (error) return [];
  return data ?? [];
}

/* ---------------- Evaluator (jury) ---------------- */
export async function listMyAssignedProjects() {
  // Filtramos explícitamente por el user_id del jurado actual. Para un
  // admin, la RLS pea_select_admin permite ver TODAS las asignaciones, por
  // lo que sin este filtro veríamos todos los proyectos como "asignados a
  // mí" en #/jurado, no solo los que el admin se auto-asignó.
  const session = (await supabase.auth.getSession())?.data?.session;
  const userId = session?.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from("project_evaluator_assignments")
    .select("project_id, evaluator:evaluators!inner(id, edition_id, user_id)")
    .eq("evaluator.user_id", userId);
  if (error) throw error;
  if (!data?.length) return [];
  const ids = [...new Set(data.map((r) => r.project_id))];
  const { data: projects, error: pe } = await supabase.from("projects").select("*").in("id", ids).order("name");
  if (pe) throw pe;
  return projects ?? [];
}

export async function getMyEvaluatorIdForEdition(editionId) {
  // Necesitamos filtrar por user_id ADEMÁS de edition_id: si el usuario es
  // admin, la RLS evaluators_select_admin le deja ver TODAS las filas, y
  // .maybeSingle() reventaría devolviendo más de un resultado. Para un
  // evaluator normal el filtro por user_id es redundante (la RLS ya lo
  // restringe a su fila), pero no estorba.
  const session = (await supabase.auth.getSession())?.data?.session;
  const userId = session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("evaluators")
    .select("id, user_id")
    .eq("edition_id", editionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function getOrCreateEvaluation({ teamId, evaluatorId, configId, phase }) {
  const { data: existing, error: e1 } = await supabase
    .from("evaluations")
    .select("*")
    .eq("team_id", teamId)
    .eq("evaluator_id", evaluatorId)
    .eq("evaluation_config_id", configId)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;
  const team = await getTeam(teamId);
  if (!team) throw new Error("Equipo no encontrado");
  const { data, error } = await supabase
    .from("evaluations")
    .insert({
      project_id: team.project_id,
      team_id: teamId,
      evaluator_id: evaluatorId,
      evaluation_config_id: configId,
      phase,
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listAnswers(evaluationId) {
  const { data, error } = await supabase.from("evaluation_answers").select("*").eq("evaluation_id", evaluationId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertAnswer({ evaluationId, itemKey, score, observation, meta }) {
  const { data, error } = await supabase
    .from("evaluation_answers")
    .upsert(
      {
        evaluation_id: evaluationId,
        item_key: itemKey,
        score,
        observation: observation ?? null,
        meta: meta ?? {},
      },
      { onConflict: "evaluation_id,item_key" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setEvaluationStatus(evaluationId, status, notes) {
  const patch = { status };
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabase.from("evaluations").update(patch).eq("id", evaluationId).select("*").single();
  if (error) throw error;
  return data;
}

// Devuelve un resumen de mis evaluaciones (status + total) por proyecto, para
// pintar el progreso en la tarjeta de proyecto del jurado y badges en cada
// equipo. Filtra por user_id porque la RLS de admin permitiría ver todo.
export async function listMyEvaluationsForProjects(projectIds) {
  if (!projectIds?.length) return [];
  const session = (await supabase.auth.getSession())?.data?.session;
  const userId = session?.user?.id;
  if (!userId) return [];
  // Resolvemos primero el evaluator_id para no mezclar otros jurados.
  const { data: evRow, error: ee } = await supabase
    .from("evaluators").select("id").eq("user_id", userId);
  if (ee) throw ee;
  const evIds = (evRow ?? []).map((r) => r.id);
  if (!evIds.length) return [];
  const { data, error } = await supabase
    .from("evaluations")
    .select("id, project_id, team_id, status, total_score, evaluator_id, evaluation_config_id, phase, updated_at")
    .in("project_id", projectIds)
    .in("evaluator_id", evIds);
  if (error) throw error;
  return data ?? [];
}

// Reabre una evaluación enviada (solo admin via RPC).
export async function adminReopenEvaluation(evaluationId) {
  const { data, error } = await supabase.rpc("admin_reopen_evaluation", { p_evaluation_id: evaluationId });
  if (error) throw error;
  return data;
}

// Lista todas las evaluaciones (cualquier jurado) de un equipo, para que el
// admin vea quiénes calificaron y pueda reabrir.
export async function adminListTeamEvaluations(teamId) {
  const { data, error } = await supabase
    .from("evaluations")
    .select(`
      id, status, total_score, phase, evaluation_config_id, updated_at,
      evaluator:evaluators!inner(id, user_id, profile:profiles(display_name))
    `)
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ---------------- Photos (por equipo) ---------------- */
export async function uploadTeamPhoto({ teamId, file, caption }) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const path = `${teamId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const { error: up } = await supabase.storage
    .from("project-photos")
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (up) throw up;
  const { data: { user } = {} } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("team_photos")
    .insert({ team_id: teamId, storage_path: path, caption: caption ?? null, uploaded_by: user?.id ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTeamPhoto(photo) {
  if (photo.storage_path) {
    await supabase.storage.from("project-photos").remove([photo.storage_path]);
  }
  const { error } = await supabase.from("team_photos").delete().eq("id", photo.id);
  if (error) throw error;
}

export async function listTeamPhotos(teamId) {
  const { data, error } = await supabase.from("team_photos").select("*").eq("team_id", teamId).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function signedPhotoUrl(path, ttl = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("project-photos").createSignedUrl(path, ttl);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* ---------------- Documents ---------------- */
export async function uploadProjectDocument({ projectId, file, title }) {
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: up } = await supabase.storage
    .from("project-documents")
    .upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
  if (up) throw up;
  const { data, error } = await supabase
    .from("project_documents")
    .insert({ project_id: projectId, storage_path: path, title: title || file.name })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function addProjectLink({ projectId, title, url }) {
  const clean = String(url || "").trim();
  if (!clean) throw new Error("La URL es obligatoria.");
  let normalized = clean;
  if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
  try { new URL(normalized); } catch { throw new Error("URL inválida."); }
  const { data, error } = await supabase
    .from("project_documents")
    .insert({ project_id: projectId, external_url: normalized, title: (title || normalized).trim() })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProjectDocument(doc) {
  if (doc.storage_path) await supabase.storage.from("project-documents").remove([doc.storage_path]);
  const { error } = await supabase.from("project_documents").delete().eq("id", doc.id);
  if (error) throw error;
}

export async function signedDocUrl(path, ttl = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("project-documents").createSignedUrl(path, ttl);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// Devuelve la URL pública del documento, sea archivo subido o enlace externo.
export async function resolveDocUrl(doc) {
  if (!doc) return null;
  if (doc.external_url) return doc.external_url;
  if (doc.storage_path) return await signedDocUrl(doc.storage_path);
  return null;
}

/* ---------------- Evaluators / Assignments ---------------- */
export async function listEvaluators(editionId) {
  const { data, error } = await supabase
    .from("evaluators")
    .select("id, user_id, active, profile:profiles(display_name, role)")
    .eq("edition_id", editionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Crea una cuenta de jurado completa llamando a la Edge Function
 * `create-evaluator`, que usa la Admin API de Supabase. Esto:
 *   - NO envía correo de confirmación (sin rate limit de email).
 *   - Crea la cuenta ya confirmada → el jurado entra de inmediato.
 *   - Asegura role='evaluator' en profiles y lo activa en la edición.
 *
 * No tocamos la sesión del admin: la function corre server-side con
 * service_role y solo lee el JWT del admin para validar permisos.
 */
export async function createEvaluatorAccount({ editionId, email, password, displayName }) {
  if (!editionId) throw new Error("Falta la edición.");
  if (!email || !email.includes("@")) throw new Error("Correo inválido.");
  if (!password || password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  if (!displayName || !displayName.trim()) throw new Error("Falta el nombre del jurado.");

  const session = (await supabase.auth.getSession())?.data?.session;
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error("Tu sesión expiró. Vuelve a iniciar sesión como admin.");
  }

  const url = `${SUPABASE_URL}/functions/v1/create-evaluator`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        editionId,
        email: email.trim().toLowerCase(),
        password,
        displayName: displayName.trim(),
      }),
    });
  } catch (e) {
    throw new Error(e?.message || "No se pudo contactar al servidor.");
  }

  let body = null;
  try { body = await res.json(); } catch {}

  if (!res.ok || !body?.ok) {
    const code = body?.error || `http_${res.status}`;
    if (code === "email_in_use") {
      throw new Error("Ese correo ya está registrado. Usa otro o pídeme que vincule la cuenta existente.");
    }
    if (code === "forbidden") {
      throw new Error("Tu cuenta no tiene permisos de admin para crear jurados.");
    }
    if (code === "weak_password") {
      throw new Error("La contraseña debe tener al menos 6 caracteres.");
    }
    if (code === "invalid_email") {
      throw new Error("Correo inválido.");
    }
    throw new Error("No se pudo crear la cuenta: " + code);
  }

  return {
    ok: true,
    requiresEmailConfirm: false,
    userId: body.userId,
    evaluatorId: body.evaluatorId,
  };
}

export async function updateEvaluatorProfile({ userId, displayName }) {
  if (!userId) throw new Error("Falta el usuario.");
  if (!displayName || !displayName.trim()) throw new Error("El nombre no puede estar vacío.");
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName.trim() })
    .eq("user_id", userId);
  if (error) throw error;
  return true;
}

export async function adminResetEvaluatorPassword(userId, newPassword) {
  if (!userId) throw new Error("Falta el usuario.");
  if (!newPassword || newPassword.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  const session = (await supabase.auth.getSession())?.data?.session;
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  const url = `${SUPABASE_URL}/functions/v1/reset-evaluator-password`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ userId, newPassword }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    const code = body?.error || `http_${res.status}`;
    if (code === "weak_password") throw new Error("La contraseña debe tener al menos 6 caracteres.");
    if (code === "forbidden") throw new Error("No tienes permisos para hacer esto.");
    throw new Error("No se pudo cambiar la contraseña: " + code);
  }
  return true;
}

export async function setAssignment({ projectId, evaluatorId, assigned }) {
  if (assigned) {
    const { error } = await supabase
      .from("project_evaluator_assignments")
      .upsert({ project_id: projectId, evaluator_id: evaluatorId });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("project_evaluator_assignments")
      .delete()
      .eq("project_id", projectId)
      .eq("evaluator_id", evaluatorId);
    if (error) throw error;
  }
}

export async function listAssignmentsForEdition(editionId) {
  const { data, error } = await supabase
    .from("project_evaluator_assignments")
    .select("project_id, evaluator_id, evaluator:evaluators!inner(edition_id)")
    .eq("evaluator.edition_id", editionId);
  if (error) throw error;
  return data ?? [];
}

/* ---------------- Configs ---------------- */
export async function listConfigs(projectId) {
  const { data, error } = await supabase
    .from("evaluation_configs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertActiveConfig({ projectId, phase, methodType, scaleMin, scaleMax, config }) {
  // Atómico vía RPC (evita 409 por race entre UPDATE y INSERT con el partial
  // unique index evaluation_configs_one_active_per_phase).
  const { data, error } = await supabase.rpc("admin_upsert_active_config", {
    p_project_id: projectId,
    p_phase: phase,
    p_method_type: methodType,
    p_scale_min: scaleMin,
    p_scale_max: scaleMax,
    p_config: config,
  });
  if (error) throw error;
  return data;
}
