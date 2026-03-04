import crypto from "crypto";
import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { sendMail } from "./_shared/mailer";
import { getOrgRole } from "./_shared/rbac";

const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function buildInviteUrl(event: any, token: string): string {
  const proto = event?.headers?.["x-forwarded-proto"] || "https";
  const host = event?.headers?.host || "kaixusuperidev2.netlify.app";
  return `${proto}://${host}/?invite_token=${encodeURIComponent(token)}`;
}

export const handler = async (event: any) => {
  const caller = await requireUser(event);
  if (!caller) return forbid();
  if (!caller.org_id) return json(400, { error: "User has no org." });

  const callerRole = await getOrgRole(caller.org_id, caller.user_id);
  if (!callerRole || !["owner", "admin"].includes(callerRole)) {
    return json(403, { error: "Forbidden: owner/admin role required." });
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "member").trim().toLowerCase();

  if (!email) return json(400, { error: "Missing email." });
  if (!VALID_ROLES.has(role)) return json(400, { error: "Invalid role." });

  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await q(
    `insert into org_invites(org_id, invited_by, invited_email, role, token_hash, expires_at)
     values($1,$2,$3,$4,$5,$6)`,
    [caller.org_id, caller.user_id, email, role, tokenHash, expiresAt]
  );

  const inviteUrl = buildInviteUrl(event, token);
  await sendMail({
    to: email,
    subject: "You are invited to kAIxU SuperIDE",
    text: [
      `${caller.email} invited you to join their organization on kAIxU SuperIDE.`,
      `Role: ${role}`,
      `Accept invite: ${inviteUrl}`,
      "This invite expires in 7 days.",
    ].join("\n"),
  });

  await audit(caller.email, caller.org_id, null, "org.team.invite", {
    invited_email: email,
    role,
    invite_url_hosted: true,
    expires_at: expiresAt,
  });

  return json(200, { ok: true, email, role, expires_at: expiresAt, invite_url: inviteUrl });
};
