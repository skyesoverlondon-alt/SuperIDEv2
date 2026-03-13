import crypto from "crypto";
import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { hashPassword, createSession, setSessionCookie } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";
import { sendMail } from "./_shared/mailer";
import { ensureOrgSeatColumns, ensurePrimaryWorkspace, getOrgSeatSummary } from "./_shared/orgs";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export const handler = async (event: any) => {
  await ensureOrgSeatColumns();

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const token = String(body.token || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();
  if (!token || !email || !password) {
    return json(400, { error: "Missing token, email, or password." });
  }

  const inviteTokenHash = sha256Hex(token);
  const inviteRes = await q(
    `select id, org_id, invited_email, role, status, expires_at
     from org_invites
     where token_hash=$1
     limit 1`,
    [inviteTokenHash]
  );

  if (!inviteRes.rows.length) return json(404, { error: "Invite not found." });
  const invite = inviteRes.rows[0];

  if (invite.status !== "pending") return json(400, { error: `Invite is ${invite.status}.` });
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    await q("update org_invites set status='expired' where id=$1", [invite.id]);
    return json(400, { error: "Invite expired." });
  }
  if (String(invite.invited_email).toLowerCase() !== email) {
    return json(400, { error: "Invite email mismatch." });
  }

  const existing = await q("select id, org_id from users where email=$1 limit 1", [email]);
  let userId: string;
  if (!existing.rows.length) {
    const pwHash = await hashPassword(password);
    const created = await q(
      "insert into users(email,password_hash,org_id) values($1,$2,$3) returning id",
      [email, pwHash, invite.org_id]
    );
    userId = created.rows[0].id;
  } else {
    const row = existing.rows[0];
    if (row.org_id && row.org_id !== invite.org_id) {
      return json(409, { error: "Account already belongs to another organization." });
    }
    userId = row.id;
    if (!row.org_id) {
      await q("update users set org_id=$1 where id=$2", [invite.org_id, userId]);
    }
    const pwHash = await hashPassword(password);
    await q("update users set password_hash=$1 where id=$2", [pwHash, userId]);
  }

  await q(
    `insert into org_memberships(org_id, user_id, role)
     values($1,$2,$3)
     on conflict (org_id, user_id) do update set role=excluded.role`,
    [invite.org_id, userId, invite.role]
  );

  const workspace = await ensurePrimaryWorkspace(invite.org_id, userId, invite.role);

  await q(
    "update org_invites set status='accepted', accepted_at=now(), accepted_by=$1 where id=$2",
    [userId, invite.id]
  );

  await q(
    `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     on conflict (org_id, user_id)
     do update set
       mailbox_email=excluded.mailbox_email,
       provider=excluded.provider,
       outbound_enabled=excluded.outbound_enabled,
       inbound_enabled=excluded.inbound_enabled,
       updated_at=now()`,
    [
      invite.org_id,
      userId,
      email,
      email,
      "gmail_smtp",
      true,
      true,
      JSON.stringify({ source: "team-invite-accept" }),
    ]
  );

  const plaintextToken = mintApiToken();
  const tokenPrefix = plaintextToken.slice(0, 14);
  const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  await q(
    "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      invite.org_id,
      userId,
      "invite-auto-1",
      tokenHash(plaintextToken),
      tokenPrefix,
      tokenExpiresAt,
      email,
      JSON.stringify(["generate"]),
    ]
  );

  const orgSummary = await getOrgSeatSummary(invite.org_id);
  const sess = await createSession(userId);
  await audit(email, invite.org_id, null, "org.team.invite.accept", {
    invite_id: invite.id,
    role: invite.role,
    default_workspace_id: workspace.id,
    default_workspace_name: workspace.name,
    auto_token_issued: true,
    token_label: "invite-auto-1",
    skymail_account_provisioned: true,
  });

  try {
    await sendMail({
      to: email,
      subject: "Welcome to your SkyeIDE workspace",
      text: [
        "Your invite has been accepted.",
        "Your session and key are active.",
        "SkyeMail mailbox routing is now provisioned for this account.",
      ].join("\n"),
    });
  } catch {
    // Non-blocking: invite acceptance should still complete.
  }

  return json(
    200,
    {
      ok: true,
      org_id: invite.org_id,
      role: invite.role,
      org: orgSummary,
      workspace,
      kaixu_token: {
        token: plaintextToken,
        label: "invite-auto-1",
        locked_email: email,
        scopes: ["generate"],
        expires_at: tokenExpiresAt,
      },
      warning: "kAIxU token is shown once on invite acceptance. Store it now.",
    },
    { "Set-Cookie": setSessionCookie(sess.token, sess.expires, event) }
  );
};
