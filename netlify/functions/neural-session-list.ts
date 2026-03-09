import { requireUser, forbid } from "./_shared/auth";
import { canReadWorkspace } from "./_shared/rbac";
import { clampString, isUuidLike, loadMission } from "./_shared/mission-control";
import { q } from "./_shared/neon";
import { json } from "./_shared/response";

function parseLimit(raw: string | undefined) {
  const n = Number(raw || 24);
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

function summarizePayload(payload: any) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const messages = Array.isArray(safePayload.messages) ? safePayload.messages : [];
  return {
    preview: String(safePayload.preview || "").trim(),
    pinned: Boolean(safePayload.pinned),
    branch_from: String(safePayload.branch_from || "").trim() || null,
    mission_id: String(safePayload.mission_id || "").trim() || null,
    message_count: messages.length,
    workspace_file_count: Number(safePayload.workspace_file_count) || 0,
    updated_at: String(safePayload.updated_at || "").trim() || null,
  };
}

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const wsId = clampString(params.ws_id, 64);
  const missionId = clampString(params.mission_id, 64);
  const recordId = clampString(params.id, 64);
  const detail = String(params.detail || "summary").trim().toLowerCase();
  const limit = parseLimit(params.limit);

  if (wsId) {
    const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace read denied." });
  }

  if (missionId) {
    if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
    const mission = await loadMission(u.org_id, missionId);
    if (!mission) return json(404, { error: "Mission not found." });
    if (mission.ws_id) {
      const allowed = await canReadWorkspace(u.org_id, u.user_id, mission.ws_id);
      if (!allowed) return json(403, { error: "Mission workspace read denied." });
    }
  }

  const clauses = ["org_id=$1", "app='NeuralSpacePro'"];
  const args: any[] = [u.org_id];
  let idx = 2;

  if (recordId) {
    clauses.push(`id=$${idx++}`);
    args.push(recordId);
  }
  if (wsId) {
    clauses.push(`ws_id=$${idx++}`);
    args.push(wsId);
  }
  if (missionId) {
    clauses.push(`coalesce(payload->>'mission_id','')=$${idx++}`);
    args.push(missionId);
  }

  args.push(limit);
  const rows = await q(
    `select id, ws_id, title, payload, created_at, updated_at
       from app_records
      where ${clauses.join(" and ")}
      order by updated_at desc
      limit $${idx}`,
    args
  );

  const items = rows.rows.map((row: any) => ({
    id: row.id,
    ws_id: row.ws_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(detail === "full"
      ? { payload: row.payload || {} }
      : summarizePayload(row.payload || {})),
  }));

  return json(200, { ok: true, items });
};