import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { ensureCoreSkychatChannels, getOrgRole, resolveAccessibleChannel } from "./_shared/skychat";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const messageId = String(body.message_id || "").trim();
  const voteRaw = Number(body.vote);
  const vote = Number.isFinite(voteRaw) ? Math.max(-1, Math.min(1, Math.trunc(voteRaw))) : 0;
  if (!messageId) return json(400, { error: "message_id is required." });

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const role = await getOrgRole(u.org_id, u.user_id);

  const target = await q(
    `select id, payload
     from app_records
     where org_id=$1 and app='SkyeChat' and id=$2
     limit 1`,
    [u.org_id, messageId]
  );
  if (!target.rows.length) return json(404, { error: "Message not found." });

  const payload = target.rows[0]?.payload && typeof target.rows[0].payload === "object" ? target.rows[0].payload : {};
  const channelSlug = String(payload.channel_slug || payload.channel || "").toLowerCase();
  const channel = await resolveAccessibleChannel(u.org_id, u.user_id, role, channelSlug);
  if (!channel) return json(403, { error: "Channel access denied." });

  const existing = await q(
    `select id
     from app_records
     where org_id=$1
       and app='SkyeChatVote'
       and coalesce(payload->>'target_id','')=$2
       and coalesce(payload->>'voter_id','')=$3
     limit 1`,
    [u.org_id, messageId, u.user_id]
  );

  if (existing.rows.length) {
    await q(
      `update app_records
       set payload=$1::jsonb, updated_at=now()
       where id=$2 and org_id=$3`,
      [
        JSON.stringify({
          target_id: messageId,
          voter_id: u.user_id,
          vote,
          channel_slug: channelSlug,
          active: vote !== 0,
        }),
        existing.rows[0].id,
        u.org_id,
      ]
    );
  } else {
    await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       values($1,null,'SkyeChatVote',$2,$3::jsonb,$4)`,
      [
        u.org_id,
        `vote:${messageId}`,
        JSON.stringify({
          target_id: messageId,
          voter_id: u.user_id,
          vote,
          channel_slug: channelSlug,
          active: vote !== 0,
        }),
        u.user_id,
      ]
    );
  }

  const scoreRes = await q(
    `select coalesce(sum(case when coalesce((payload->>'vote')::int,0) > 0 then 1 when coalesce((payload->>'vote')::int,0) < 0 then -1 else 0 end),0) as score
     from app_records
     where org_id=$1 and app='SkyeChatVote' and coalesce(payload->>'target_id','')=$2 and coalesce((payload->>'active')::boolean, false)=true`,
    [u.org_id, messageId]
  );
  const score = Number(scoreRes.rows[0]?.score || 0);

  await audit(u.email, u.org_id, null, "skychat.vote", {
    message_id: messageId,
    vote,
    score,
    channel: channelSlug,
  });

  return json(200, { ok: true, message_id: messageId, vote, score });
};
