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
  const before = String(params.before || "").trim();
  const channel = String(params.channel || "").trim().toLowerCase();
  const search = String(params.q || "").trim().toLowerCase();
  const searchLike = search ? `%${search}%` : "";

  const rows = await q(
    `select id, app, title, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and app='SkyeChat'
       and ($2::timestamptz is null or updated_at < $2::timestamptz)
       and ($3::text = '' or lower(coalesce(payload->>'channel','')) = $3)
       and (
         $4::text = ''
         or lower(title) like $5
         or lower(coalesce(payload->>'message','')) like $5
         or lower(coalesce(payload->>'source','')) like $5
       )
     order by updated_at desc
     limit $6`,
    [u.org_id, before || null, channel, search, searchLike, limit]
  );

  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.updated_at || null : null;
  const hasMore = rows.rows.length === limit;

  return json(200, {
    ok: true,
    records: rows.rows,
    page: { limit, before: before || null, next_before: nextBefore, has_more: hasMore },
  });
};
