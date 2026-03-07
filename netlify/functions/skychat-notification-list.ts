import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

function parseLimit(raw: string | undefined): number {
  const n = Number(raw || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const limit = parseLimit(params.limit);
  const kind = String(params.kind || "").trim().toLowerCase();
  const unreadOnly = String(params.unread_only || "").trim() === "1";
  const before = String(params.before || "").trim();

  const rows = await q(
    `select id, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and app='SkyeNotification'
       and coalesce(payload->>'target_user_id','')=$2
       and ($3::text='' or lower(coalesce(payload->>'kind',''))=$3)
       and ($4::boolean=false or coalesce((payload->>'read')::boolean, false)=false)
       and ($5::timestamptz is null or created_at < $5::timestamptz)
     order by
       case when lower(coalesce(payload->>'priority',''))='critical' then 3 when lower(coalesce(payload->>'priority',''))='high' then 2 else 1 end desc,
       created_at desc
     limit $6`,
    [u.org_id, u.user_id, kind, unreadOnly, before || null, limit]
  );

  const items = rows.rows.map((row) => {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      id: row.id,
      kind: String(payload.kind || "notification"),
      priority: String(payload.priority || "normal"),
      channel: String(payload.channel || ""),
      message: String(payload.message || ""),
      read: Boolean(payload.read),
      source_record_id: String(payload.source_record_id || ""),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  const unreadCount = items.filter((x) => !x.read).length;
  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.created_at || null : null;

  return json(200, {
    ok: true,
    notifications: items,
    unread_count: unreadCount,
    page: { limit, before: before || null, next_before: nextBefore, has_more: rows.rows.length === limit },
  });
};
