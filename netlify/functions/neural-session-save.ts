import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { readCorrelationId } from "./_shared/correlation";
import { canWriteWorkspace } from "./_shared/rbac";
import { clampString, isUuidLike, loadMission, canWriteMission, touchMission } from "./_shared/mission-control";
import { q } from "./_shared/neon";
import { json } from "./_shared/response";
import { emitSovereignEvent } from "./_shared/sovereign-events";

function normalizeMessages(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<Record<string, unknown>>;
  return input.slice(0, 200).map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const role = clampString(row.role, 24) || "user";
    const content = clampString(row.content, 120000);
    const timestamp = Number(row.timestamp) || Date.now();
    const attachments = Array.isArray(row.attachments)
      ? row.attachments.slice(0, 12).map((item) => ({
          name: clampString((item as any)?.name, 160),
          type: clampString((item as any)?.type, 40),
        }))
      : [];
    return { role, content, timestamp, attachments };
  });
}

function normalizeWorkspaceSummary(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const files = Array.isArray(row.files)
    ? row.files.slice(0, 24).map((file) => ({
        path: clampString((file as any)?.path, 240),
        size: Number((file as any)?.size) || 0,
      }))
    : [];
  return {
    revision: clampString(row.revision, 120),
    total_chars: Number(row.total_chars) || 0,
    files,
  };
}

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "POST").toUpperCase() !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const recordId = clampString(body.id, 64);
  const wsId = clampString(body.ws_id, 64);
  const missionId = clampString(body.mission_id, 64);
  const title = clampString(body.title, 200) || "Neural Session";
  const preview = clampString(body.preview, 500);
  const branchFrom = clampString(body.branch_from, 64);
  const pinned = Boolean(body.pinned);
  const messages = normalizeMessages(body.messages);
  const workspaceSummary = normalizeWorkspaceSummary(body.workspace_summary);

  if (!wsId) return json(400, { error: "Missing ws_id." });
  const workspaceAllowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!workspaceAllowed) return json(403, { error: "Workspace write denied." });

  let mission: any = null;
  if (missionId) {
    if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
    mission = await loadMission(u.org_id, missionId);
    if (!mission) return json(404, { error: "Mission not found." });
    const missionAllowed = await canWriteMission(u.org_id, u.user_id, mission.ws_id || null);
    if (!missionAllowed) return json(403, { error: "Mission write denied." });
  }

  const payload = {
    schema: "neural-session-v1",
    mission_id: missionId || null,
    branch_from: branchFrom || null,
    preview,
    pinned,
    message_count: messages.length,
    messages,
    workspace_summary: workspaceSummary,
    workspace_file_count: Array.isArray(workspaceSummary?.files) ? workspaceSummary.files.length : 0,
    updated_at: new Date().toISOString(),
  };

  let saved: any;
  let isUpdate = false;
  if (recordId) {
    saved = await q(
      `update app_records
          set title=$1,
              ws_id=$2,
              payload=$3::jsonb,
              updated_at=now()
        where id=$4
          and org_id=$5
          and app='NeuralSpacePro'
        returning id, ws_id, title, payload, created_at, updated_at`,
      [title, wsId, JSON.stringify(payload), recordId, u.org_id]
    );
    if (!saved.rows.length) return json(404, { error: "Neural session not found." });
    isUpdate = true;
  } else {
    saved = await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       values($1,$2,'NeuralSpacePro',$3,$4::jsonb,$5)
       returning id, ws_id, title, payload, created_at, updated_at`,
      [u.org_id, wsId, title, JSON.stringify(payload), u.user_id]
    );
  }

  const item = saved.rows[0] || null;
  const correlationId = readCorrelationId(event);

  if (missionId && item?.id) {
    await q(
      `insert into mission_assets(mission_id, source_app, asset_kind, asset_id, title, detail, attached_by)
       values($1,'NeuralSpacePro','neural_session',$2,$3,$4::jsonb,$5)
       on conflict (mission_id, asset_id)
       do update set
         source_app=excluded.source_app,
         asset_kind=excluded.asset_kind,
         title=excluded.title,
         detail=excluded.detail,
         attached_by=excluded.attached_by`,
      [missionId, item.id, title, JSON.stringify({ ws_id: wsId, preview, message_count: messages.length }), u.user_id]
    );
    await touchMission(missionId);
  }

  await audit(u.email, u.org_id, wsId, isUpdate ? "neural.session.update" : "neural.session.create", {
    record_id: item?.id || null,
    mission_id: missionId || null,
    title,
    message_count: messages.length,
    correlation_id: correlationId || null,
  });

  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId,
    missionId: missionId || null,
    eventType: isUpdate ? "neural.session.updated" : "neural.session.created",
    sourceApp: "NeuralSpacePro",
    sourceRoute: "/api/neural-session-save",
    subjectKind: "app_record",
    subjectId: String(item?.id || ""),
    severity: "info",
    summary: `Neural session ${isUpdate ? "updated" : "created"}: ${title}`,
    correlationId,
    payload: {
      title,
      mission_id: missionId || null,
      message_count: messages.length,
      preview: preview || null,
    },
  });

  return json(200, { ok: true, item });
};