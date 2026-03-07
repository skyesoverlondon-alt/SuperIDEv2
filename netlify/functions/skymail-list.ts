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
  const mailbox = String(params.mailbox || "").trim().toLowerCase();
  const search = String(params.q || "").trim().toLowerCase();
  const label = String(params.label || "").trim().toLowerCase();
  const threadId = String(params.thread_id || "").trim();
  const unreadOnly = String(params.unread_only || "").trim() === "1";
  const searchLike = search ? `%${search}%` : "";

  const rows = await q(
    `select id, app, title, payload, created_at, updated_at,
       (
         case when $4::text = '' then 0 else
           (case when lower(coalesce(payload->>'subject','')) = $4 then 40 else 0 end) +
           (case when lower(title) like $5 then 18 else 0 end) +
           (case when lower(coalesce(payload->>'from','')) like $5 then 14 else 0 end) +
           (case when lower(coalesce(payload->>'to','')) like $5 then 14 else 0 end) +
           (case when lower(coalesce(payload->>'text','')) like $5 then 8 else 0 end)
         end
       ) as score
     from app_records
     where org_id=$1
       and app in ('SkyeMail', 'SkyeMailInbound')
       and ($2::timestamptz is null or updated_at < $2::timestamptz)
       and (
         $3::text = ''
         or lower(coalesce(payload->>'to','')) = $3
         or lower(coalesce(payload->>'mailbox','')) = $3
       )
       and (
         $4::text = ''
         or lower(title) like $5
         or lower(coalesce(payload->>'from','')) like $5
         or lower(coalesce(payload->>'mailbox','')) like $5
         or lower(coalesce(payload->>'to','')) like $5
         or lower(coalesce(payload->>'subject','')) like $5
         or lower(coalesce(payload->>'text','')) like $5
       )
       and ($6::text = '' or exists (
         select 1
         from jsonb_array_elements_text(coalesce(payload->'labels','[]'::jsonb)) as lbl
         where lower(lbl) = $6
       ))
       and ($7::text = '' or coalesce(payload->>'thread_id','') = $7)
       and ($8::boolean = false or coalesce((payload->>'unread')::boolean, false) = true)
     order by score desc, updated_at desc
     limit $9`,
    [u.org_id, before || null, mailbox, search, searchLike, label, threadId, unreadOnly, limit]
  );

  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.updated_at || null : null;
  const hasMore = rows.rows.length === limit;

  return json(200, { ok: true, records: rows.rows, page: { limit, before: before || null, next_before: nextBefore, has_more: hasMore } });
};
