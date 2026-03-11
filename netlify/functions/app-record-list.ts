import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";
import { ALLOWED_APP_RECORD_APPS } from "./_shared/app-records";

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
  const wsId = String(params.ws_id || "").trim();
  const app = String(params.app || "").trim();
  const limit = parseLimit(params.limit);

  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!ALLOWED_APP_RECORD_APPS.has(app)) return json(400, { error: "Unsupported app." });

  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });

  const rows = await q(
    `select id, app, ws_id, title, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and ws_id=$2
       and app=$3
     order by updated_at desc
     limit $4`,
    [u.org_id, wsId, app, limit]
  );

  return json(200, {
    ok: true,
    records: rows.rows,
  });
};
