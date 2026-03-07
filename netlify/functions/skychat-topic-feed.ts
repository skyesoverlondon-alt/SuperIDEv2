import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { ensureCoreSkychatChannels, getOrgRole, listAccessibleChannels } from "./_shared/skychat";

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
  const topic = String(params.topic || "").trim().toLowerCase();
  const period = String(params.period || "7d").trim().toLowerCase();
  const limit = parseLimit(params.limit);

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const role = await getOrgRole(u.org_id, u.user_id);
  const channels = await listAccessibleChannels(u.org_id, u.user_id, role);
  const channelSlugs = channels.map((c) => c.slug);
  if (!channelSlugs.length) return json(200, { ok: true, records: [], topics: [] });

  const interval = period === "24h" ? "24 hours" : period === "30d" ? "30 days" : "7 days";

  const rows = await q(
    `select a.id, a.title, a.payload, a.created_at, a.updated_at,
       coalesce((
         select sum(case when coalesce((v.payload->>'vote')::int,0) > 0 then 1 when coalesce((v.payload->>'vote')::int,0) < 0 then -1 else 0 end)
         from app_records v
         where v.org_id=a.org_id and v.app='SkyeChatVote' and coalesce(v.payload->>'target_id','')=a.id::text and coalesce((v.payload->>'active')::boolean,false)=true
       ), 0) as vote_score,
       (
         select count(*)::int
         from app_records r
         where r.org_id=a.org_id and r.app='SkyeChat' and coalesce(r.payload->>'root_id','')=a.id::text and coalesce(r.payload->>'post_type','post')='reply'
       ) as reply_count
     from app_records a
     where a.org_id=$1
       and a.app='SkyeChat'
       and lower(coalesce(a.payload->>'channel_slug', a.payload->>'channel','')) = any($2::text[])
       and coalesce(a.payload->>'post_type','post')='post'
       and ($3::text='' or lower(coalesce(a.payload->>'topic',''))=$3)
       and a.updated_at > now() - ($4::text)::interval
     order by vote_score desc, reply_count desc, a.updated_at desc
     limit $5`,
    [u.org_id, channelSlugs, topic, interval, limit]
  );

  const topicRows = await q(
    `select lower(coalesce(payload->>'topic','')) as topic, count(*)::int as c
     from app_records
     where org_id=$1 and app='SkyeChat'
       and lower(coalesce(payload->>'channel_slug', payload->>'channel','')) = any($2::text[])
       and coalesce(payload->>'post_type','post')='post'
       and coalesce(payload->>'topic','') <> ''
       and updated_at > now() - ($3::text)::interval
     group by lower(coalesce(payload->>'topic',''))
     order by c desc, topic asc
     limit 20`,
    [u.org_id, channelSlugs, interval]
  );

  return json(200, {
    ok: true,
    period,
    topic: topic || null,
    records: rows.rows,
    topics: topicRows.rows,
  });
};
