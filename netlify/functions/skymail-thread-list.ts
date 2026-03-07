import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const threadId = String(params.thread_id || "").trim();
  if (!threadId) return json(400, { error: "thread_id is required." });

  const rows = await q(
    `select id, app, title, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and app in ('SkyeMail', 'SkyeMailInbound')
       and coalesce(payload->>'thread_id','')=$2
     order by created_at asc`,
    [u.org_id, threadId]
  );

  return json(200, { ok: true, thread_id: threadId, records: rows.rows });
};
