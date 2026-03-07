import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";

function parseLimit(raw: string | undefined): number {
  const n = Number(raw || 20);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const limit = parseLimit(params.limit);

  if (!wsId) return json(400, { error: "Missing ws_id." });

  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });

  const rows = await q(
    `select id, title, payload, created_at, updated_at
       from app_records
      where org_id=$1
        and ws_id=$2
        and app='SkyeDrive'
        and payload->>'kind'='workspace-source'
      order by updated_at desc
      limit $3`,
    [u.org_id, wsId, limit]
  );

  return json(200, {
    ok: true,
    records: rows.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      file_count: Array.isArray(row?.payload?.files) ? row.payload.files.length : Number(row?.payload?.file_count || 0),
      note: String(row?.payload?.note || "").trim() || null,
      source: String(row?.payload?.source || "SkyeDrive").trim(),
      source_kind: String(row?.payload?.source_kind || "workspace-save").trim() || "workspace-save",
      source_name: String(row?.payload?.source_name || "").trim() || null,
    })),
  });
};