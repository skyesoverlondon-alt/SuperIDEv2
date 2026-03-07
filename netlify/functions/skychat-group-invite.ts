import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import {
  addMemberToChannel,
  ensureCoreSkychatChannels,
  getOrgRole,
  isOrgAdmin,
  resolveAccessibleChannel,
} from "./_shared/skychat";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const channel = String(body.channel || "").trim();
  const inviteEmail = String(body.email || "").trim().toLowerCase();
  const inviteRole = String(body.role || "member").trim().toLowerCase() === "moderator" ? "moderator" : "member";

  if (!channel) return json(400, { error: "Missing channel." });
  if (!inviteEmail || !EMAIL_RE.test(inviteEmail)) return json(400, { error: "Valid invite email is required." });

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  const channelInfo = await resolveAccessibleChannel(u.org_id, u.user_id, orgRole, channel);
  if (!channelInfo) return json(404, { error: "Channel not found or inaccessible." });
  if (channelInfo.kind !== "group") return json(400, { error: "Invites are only supported for group channels." });

  const admin = isOrgAdmin(orgRole);
  const isOwner = channelInfo.owner_user_id && channelInfo.owner_user_id === u.user_id;
  if (!admin && !isOwner) return json(403, { error: "Only group owner/admin can invite members." });

  const target = await q(
    `select u.id, u.email
     from users u
     join org_memberships m on m.user_id=u.id and m.org_id=$1
     where lower(u.email)=$2
     limit 1`,
    [u.org_id, inviteEmail]
  );
  if (!target.rows.length) {
    return json(404, { error: "User must already be in this organization before joining private groups." });
  }

  const invitedUserId = String(target.rows[0].id);
  await addMemberToChannel(u.org_id, u.user_id, channelInfo.id, channelInfo.slug, invitedUserId, inviteRole as "member" | "moderator");

  await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,null,'SkyeNotification',$2,$3::jsonb,$4)`,
    [
      u.org_id,
      "Group Invite",
      JSON.stringify({
        kind: "group_invite",
        read: false,
        target_user_id: invitedUserId,
        channel: channelInfo.slug,
        message: `You were added to #${channelInfo.slug}.`,
        invited_by: u.email,
      }),
      u.user_id,
    ]
  );

  await audit(u.email, u.org_id, null, "skychat.group.invite", {
    channel: channelInfo.slug,
    invited_email: inviteEmail,
    role: inviteRole,
  });

  return json(200, {
    ok: true,
    channel: channelInfo.slug,
    invited_email: inviteEmail,
    role: inviteRole,
  });
};
