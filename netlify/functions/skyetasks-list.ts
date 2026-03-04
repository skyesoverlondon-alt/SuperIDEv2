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
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const limit = parseLimit(params.limit);
  const before = String(params.before || "").trim();
  const wsId = String(params.ws_id || "").trim();
  if (!wsId) return json(400, { error: "Missing ws_id." });

  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });

  const rows = await q(
    `select id, app, ws_id, title, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and app='SkyeTasks'
       and ws_id::text = $2
       and ($3::timestamptz is null or updated_at < $3::timestamptz)
     order by updated_at desc
     limit $4`,
    [u.org_id, wsId, before || null, limit]
  );

  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.updated_at || null : null;
  const hasMore = rows.rows.length === limit;
  return json(200, {
    ok: true,
    records: rows.rows,
    page: { limit, before: before || null, next_before: nextBefore, has_more: hasMore },
  });
};
