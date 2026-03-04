import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

function parseLimit(raw: string | undefined): number {
  const n = Number(raw || 100);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(n)));
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const limit = parseLimit(params.limit);

  const rows = await q(
    `select id, at, actor, org_id, ws_id, type, meta
     from audit_events
     where org_id=$1
       and type in ('sknore.blocked.active_path','sknore.blocked.files')
       and ($2::uuid is null or ws_id=$2::uuid)
     order by at desc
     limit $3`,
    [u.org_id, wsId || null, limit]
  );

  return json(200, { ok: true, events: rows.rows });
};
