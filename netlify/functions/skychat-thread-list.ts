import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { ensureCoreSkychatChannels, getOrgRole, resolveAccessibleChannel } from "./_shared/skychat";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const rootId = String(params.root_id || "").trim();
  const messageId = String(params.message_id || "").trim();
  if (!rootId && !messageId) return json(400, { error: "root_id or message_id is required." });

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const role = await getOrgRole(u.org_id, u.user_id);

  const rootRow = await q(
    `select id, payload
     from app_records
     where org_id=$1 and app='SkyeChat' and id=coalesce($2::uuid, $3::uuid)
     limit 1`,
    [u.org_id, rootId || null, messageId || null]
  );
  if (!rootRow.rows.length) return json(404, { error: "Thread root not found." });

  const basePayload = rootRow.rows[0]?.payload && typeof rootRow.rows[0].payload === "object" ? rootRow.rows[0].payload : {};
  const channelSlug = String(basePayload.channel_slug || basePayload.channel || "").toLowerCase();
  const channel = await resolveAccessibleChannel(u.org_id, u.user_id, role, channelSlug);
  if (!channel) return json(403, { error: "Channel access denied." });

  const effectiveRoot = String(basePayload.root_id || rootRow.rows[0].id);

  const rows = await q(
    `select a.id, a.title, a.payload, a.created_at, a.updated_at,
       coalesce((
         select sum(case when coalesce((v.payload->>'vote')::int,0) > 0 then 1 when coalesce((v.payload->>'vote')::int,0) < 0 then -1 else 0 end)
         from app_records v
         where v.org_id=a.org_id and v.app='SkyeChatVote' and coalesce(v.payload->>'target_id','')=a.id::text
       ), 0) as vote_score,
       coalesce((
         select max(coalesce((v.payload->>'vote')::int,0))
         from app_records v
         where v.org_id=a.org_id and v.app='SkyeChatVote'
           and coalesce(v.payload->>'target_id','')=a.id::text
           and coalesce(v.payload->>'voter_id','')=$2
       ), 0) as user_vote
     from app_records a
     where a.org_id=$1
       and a.app='SkyeChat'
       and (
         a.id::text=$3
         or coalesce(a.payload->>'root_id','')=$3
       )
       and lower(coalesce(a.payload->>'channel_slug', a.payload->>'channel',''))=$4
     order by coalesce((a.payload->>'depth')::int, 0) asc, a.created_at asc`,
    [u.org_id, u.user_id, effectiveRoot, channelSlug]
  );

  return json(200, {
    ok: true,
    root_id: effectiveRoot,
    channel: channelSlug,
    records: rows.rows,
  });
};
