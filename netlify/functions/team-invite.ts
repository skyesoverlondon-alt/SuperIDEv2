import crypto from "crypto";
import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { sendMail } from "./_shared/mailer";
import { getOrgRole } from "./_shared/rbac";
import { assertOrgSeatCapacity, ensureOrgSeatColumns } from "./_shared/orgs";

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
  await ensureOrgSeatColumns();

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

  const existingMember = await q(
    `select m.user_id
     from org_memberships m
     join users u on u.id = m.user_id
     where m.org_id=$1 and lower(u.email)=lower($2)
     limit 1`,
    [caller.org_id, email]
  );
  if (existingMember.rows.length) {
    return json(409, { error: "That email already belongs to this organization." });
  }

  const existingInvite = await q(
    `select id, expires_at
     from org_invites
     where org_id=$1 and lower(invited_email)=lower($2) and status='pending' and expires_at > now()
     order by created_at desc
     limit 1`,
    [caller.org_id, email]
  );
  if (existingInvite.rows.length) {
    return json(409, {
      error: "A pending invite already exists for that email.",
      expires_at: existingInvite.rows[0].expires_at,
    });
  }

  let seatSummary;
  try {
    seatSummary = await assertOrgSeatCapacity(caller.org_id, 1);
  } catch (error: any) {
    if (error?.code === "seat_limit_reached") {
      return json(409, {
        error: "Seat limit reached. Pending invites already reserve seats.",
        seat_summary: error.seatSummary || null,
      });
    }
    if (error?.code === "org_not_found") {
      return json(404, { error: "Organization not found." });
    }
    throw error;
  }

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
    seat_plan_tier: seatSummary.plan_tier,
    seat_limit: seatSummary.seat_limit,
    seats_reserved_before_invite: seatSummary.seats_reserved,
    invite_url_hosted: true,
    expires_at: expiresAt,
  });

  return json(200, {
    ok: true,
    email,
    role,
    expires_at: expiresAt,
    invite_url: inviteUrl,
    seat_summary: {
      ...seatSummary,
      pending_invites: seatSummary.pending_invites + 1,
      seats_reserved: seatSummary.seats_reserved + 1,
      seats_available:
        seatSummary.seat_limit == null ? null : Math.max(seatSummary.seat_limit - (seatSummary.seats_reserved + 1), 0),
    },
  });
};
