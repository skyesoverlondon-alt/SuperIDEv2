import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { ensureCoreSkychatChannels, getOrgRole, listAccessibleChannels, resolveAccessibleChannel } from "./_shared/skychat";

function parseLimit(raw: string | undefined): number {
  const n = Number(raw || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

function parseSort(raw: string | undefined): "new" | "top" | "hot" {
  const v = String(raw || "hot").trim().toLowerCase();
  if (v === "new" || v === "top") return v;
  return "hot";
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
  const topic = String(params.topic || "").trim().toLowerCase();
  const includeReplies = String(params.include_replies || "").trim() === "1";
  const sort = parseSort(params.sort);
  const searchLike = search ? `%${search}%` : "";

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  const channels = await listAccessibleChannels(u.org_id, u.user_id, orgRole);
  const channelSlugs = channels.map((c) => c.slug);
  if (!channelSlugs.length) {
    return json(200, { ok: true, records: [], channels: [], notifications: { unread_count: 0, recent: [] }, page: { limit, before: before || null, next_before: null, has_more: false } });
  }

  let activeChannel = "";
  if (channel) {
    const resolved = await resolveAccessibleChannel(u.org_id, u.user_id, orgRole, channel);
    if (!resolved) return json(403, { error: "Channel access denied." });
    activeChannel = resolved.slug;
  }

  const rows = await q(
    `select id, app, title, payload, created_at, updated_at,
       coalesce((
         select sum(case when coalesce((v.payload->>'vote')::int, 0) > 0 then 1 when coalesce((v.payload->>'vote')::int, 0) < 0 then -1 else 0 end)
         from app_records v
         where v.org_id=a.org_id
           and v.app='SkyeChatVote'
           and coalesce(v.payload->>'target_id','')=a.id::text
       ), 0) as vote_score,
       (
         select count(*)::int
         from app_records r
         where r.org_id=a.org_id
           and r.app='SkyeChat'
           and coalesce(r.payload->>'root_id','')=a.id::text
           and coalesce(r.payload->>'post_type','post')='reply'
       ) as reply_count,
       (
         coalesce((
           select sum(case when coalesce((v.payload->>'vote')::int, 0) > 0 then 1 when coalesce((v.payload->>'vote')::int, 0) < 0 then -1 else 0 end)
           from app_records v
           where v.org_id=a.org_id
             and v.app='SkyeChatVote'
             and coalesce(v.payload->>'target_id','')=a.id::text
         ), 0) * 3
         + extract(epoch from a.updated_at) / 3600.0
       ) as hot_score
     from app_records
     a
     where org_id=$1
       and app='SkyeChat'
       and ($2::timestamptz is null or updated_at < $2::timestamptz)
       and lower(coalesce(payload->>'channel_slug', payload->>'channel','')) = any($3::text[])
       and ($4::text = '' or lower(coalesce(payload->>'channel_slug', payload->>'channel','')) = $4)
       and ($5::text = '' or lower(coalesce(payload->>'topic','')) = $5)
       and ($6::boolean = true or coalesce(payload->>'post_type','post') <> 'reply')
       and (
         $7::text = ''
         or lower(title) like $8
         or lower(coalesce(payload->>'message','')) like $8
         or lower(coalesce(payload->>'source','')) like $8
       )
     order by
       case when $9::text='top' then vote_score end desc,
       case when $9::text='hot' then hot_score end desc,
       updated_at desc
     limit $10`,
    [u.org_id, before || null, channelSlugs, activeChannel, topic, includeReplies, search, searchLike, sort, limit]
  );

  const notifRows = await q(
    `select id, payload, created_at
     from app_records
     where org_id=$1
       and app='SkyeNotification'
       and coalesce(payload->>'target_user_id','')=$2
     order by created_at desc
       and ($3::text = '' or lower(coalesce(payload->>'kind','')) = $3)
       and ($4::boolean = false or coalesce((payload->>'read')::boolean, false) = false)
     order by
       case when lower(coalesce(payload->>'priority',''))='critical' then 3 when lower(coalesce(payload->>'priority',''))='high' then 2 else 1 end desc,
       created_at desc
     limit 40`,
    [u.org_id, u.user_id, "", false]
  );

  const recentNotifications = notifRows.rows.map((row) => {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      id: row.id,
      message: String(payload.message || ""),
      kind: String(payload.kind || "notification"),
      channel: String(payload.channel || ""),
      priority: String(payload.priority || "normal"),
      read: Boolean(payload.read),
      created_at: row.created_at,
    };
  });
  const unreadCount = recentNotifications.filter((n) => !n.read).length;

  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.updated_at || null : null;
  const hasMore = rows.rows.length === limit;

  return json(200, {
    ok: true,
    records: rows.rows,
    channels,
    feed: {
      sort,
      topic: topic || null,
      include_replies: includeReplies,
    },
    active_channel: activeChannel || (channel || "community"),
    notifications: { unread_count: unreadCount, recent: recentNotifications.slice(0, 8) },
    page: { limit, before: before || null, next_before: nextBefore, has_more: hasMore },
  });
};
