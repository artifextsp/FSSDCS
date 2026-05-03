import { supabase } from "./supabase.js";

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
  const { data, error } = await supabase
    .from("editions")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ---------------- Projects ---------------- */
export async function listProjects(editionId) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("edition_id", editionId)
    .order("presentation_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getProject(id) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getProjectFull(id) {
  const project = await getProject(id);
  if (!project) return null;
  const [team, photos, docs, configs, score] = await Promise.all([
    supabase.from("teams").select("*").eq("project_id", id).maybeSingle().then((r) => r.data),
    supabase.from("project_photos").select("*").eq("project_id", id).order("created_at", { ascending: true }).then((r) => r.data ?? []),
    supabase.from("project_documents").select("*").eq("project_id", id).order("sort_order", { ascending: true }).then((r) => r.data ?? []),
    supabase.from("evaluation_configs").select("*").eq("project_id", id).eq("is_active", true).then((r) => r.data ?? []),
    supabase.from("project_score_cache").select("*").eq("project_id", id).maybeSingle().then((r) => r.data),
  ]);
  let members = [];
  if (team?.id) {
    const { data } = await supabase
      .from("team_members")
      .select("*")
      .eq("team_id", team.id)
      .order("sort_order", { ascending: true });
    members = data ?? [];
  }
  return { project, team, members, photos, docs, configs, score };
}

/* ---------------- Ranking ---------------- */
export async function listRanking(editionId) {
  const { data, error } = await supabase
    .from("public_project_rankings")
    .select("*")
    .eq("edition_id", editionId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ---------------- Team portal ---------------- */
export async function teamPortalLookup(slug, name) {
  const { data, error } = await supabase.rpc("team_portal_lookup", {
    p_edition_slug: slug,
    p_team_name: name,
  });
  if (error) throw error;
  return data;
}

/* ---------------- Evaluator (jury) ---------------- */
export async function listMyAssignedProjects() {
  const { data: pas, error } = await supabase
    .from("project_evaluator_assignments")
    .select("project_id, evaluator:evaluators!inner(id, edition_id)");
  if (error) throw error;
  if (!pas?.length) return [];
  const projectIds = [...new Set(pas.map((r) => r.project_id))];
  const { data: projects, error: pe } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds);
  if (pe) throw pe;
  return projects ?? [];
}

export async function getMyEvaluatorIdForEdition(editionId) {
  const { data, error } = await supabase
    .from("evaluators")
    .select("id, user_id")
    .eq("edition_id", editionId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function getOrCreateEvaluation({ projectId, evaluatorId, configId, phase }) {
  const { data: existing, error: e1 } = await supabase
    .from("evaluations")
    .select("*")
    .eq("project_id", projectId)
    .eq("evaluator_id", evaluatorId)
    .eq("evaluation_config_id", configId)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;
  const { data, error } = await supabase
    .from("evaluations")
    .insert({
      project_id: projectId,
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
  const { data, error } = await supabase
    .from("evaluation_answers")
    .select("*")
    .eq("evaluation_id", evaluationId);
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
  const { data, error } = await supabase
    .from("evaluations")
    .update(patch)
    .eq("id", evaluationId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/* ---------------- Photos ---------------- */
export async function uploadProjectPhoto({ projectId, file, caption }) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const { error: up } = await supabase.storage
    .from("project-photos")
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (up) throw up;
  const { data: { user } = {} } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("project_photos")
    .insert({
      project_id: projectId,
      storage_path: path,
      caption: caption ?? null,
      uploaded_by: user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProjectPhoto(photo) {
  if (photo.storage_path) {
    await supabase.storage.from("project-photos").remove([photo.storage_path]);
  }
  const { error } = await supabase.from("project_photos").delete().eq("id", photo.id);
  if (error) throw error;
}

export async function signedPhotoUrl(path, ttl = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("project-photos")
    .createSignedUrl(path, ttl);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function signedDocUrl(path, ttl = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("project-documents")
    .createSignedUrl(path, ttl);
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
    .insert({
      project_id: projectId,
      storage_path: path,
      title: title || file.name,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProjectDocument(doc) {
  if (doc.storage_path) {
    await supabase.storage.from("project-documents").remove([doc.storage_path]);
  }
  const { error } = await supabase.from("project_documents").delete().eq("id", doc.id);
  if (error) throw error;
}

/* ---------------- Admin: editions/projects/teams/evaluators/configs ---------------- */
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

export async function upsertTeam({ projectId, name }) {
  const existing = await supabase.from("teams").select("*").eq("project_id", projectId).maybeSingle();
  if (existing.data) {
    const { data, error } = await supabase
      .from("teams")
      .update({ name })
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from("teams").insert({ project_id: projectId, name }).select("*").single();
  if (error) throw error;
  return data;
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

export async function listEvaluators(editionId) {
  const { data, error } = await supabase
    .from("evaluators")
    .select("id, user_id, active, profile:profiles(display_name, role)")
    .eq("edition_id", editionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listEvaluatorsWithEmails(editionId) {
  return listEvaluators(editionId);
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
  // Deactivate previous active in same phase
  await supabase
    .from("evaluation_configs")
    .update({ is_active: false })
    .eq("project_id", projectId)
    .eq("phase", phase)
    .eq("is_active", true);
  const { data, error } = await supabase
    .from("evaluation_configs")
    .insert({
      project_id: projectId,
      phase,
      method_type: methodType,
      scale_min: scaleMin,
      scale_max: scaleMax,
      config,
      is_active: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
