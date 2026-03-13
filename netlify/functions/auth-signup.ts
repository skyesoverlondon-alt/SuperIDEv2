import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { hashPassword, createSession, setSessionCookie, ensureUserRecoveryEmailColumn, ensureUserPinColumns } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";
import { hasMailDeliveryConfig, sendMail } from "./_shared/mailer";
import { ensureOrgSeatColumns, ensurePrimaryWorkspace, getOrgSeatSummary } from "./_shared/orgs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event: any) => {
  try {
    await ensureUserRecoveryEmailColumn();
    await ensureUserPinColumns();
    await ensureOrgSeatColumns();

    const { email, password, orgName, recoveryEmail, recovery_email } = JSON.parse(event.body || "{}");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRecoveryEmail = String(recoveryEmail || recovery_email || "").trim().toLowerCase();
    const normalizedOrg = String(orgName || "").trim();
    const rawPassword = String(password || "");

    if (!normalizedEmail || !normalizedRecoveryEmail || !rawPassword || !normalizedOrg) {
      return json(400, { error: "Primary SKYEMAIL login, recovery email, password, and organization name are required." });
    }

    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid SKYEMAIL login address." });
    }

    if (!EMAIL_RE.test(normalizedRecoveryEmail)) {
      return json(400, { error: "Enter a valid third-party recovery email." });
    }

    if (normalizedRecoveryEmail === normalizedEmail) {
      return json(400, { error: "Recovery email must be different from the SKYEMAIL primary login." });
    }

    if (rawPassword.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }

    if (normalizedOrg.length < 2) {
      return json(400, { error: "Organization name must be at least 2 characters." });
    }

    if (!hasMailDeliveryConfig()) {
      return json(503, {
        error: "Signup email delivery is not configured. Set SMTP_* or RESEND_API_KEY and try again.",
      });
    }

    const existing = await q("select id from users where email=$1 limit 1", [normalizedEmail]);
    if (existing.rows.length) {
      return json(409, { error: "Account already exists. Sign in instead." });
    }

    const pwHash = await hashPassword(rawPassword);
    const userRow = await q(
      `with created_org as (
         insert into orgs(name) values($1) returning id
       )
       insert into users(email,recovery_email,password_hash,org_id)
       select $2, $3, $4, id from created_org
       returning id,email,recovery_email,org_id`,
      [normalizedOrg, normalizedEmail, normalizedRecoveryEmail, pwHash]
    );

    const orgId = userRow.rows[0].org_id;
    const userId = userRow.rows[0].id;

    await q(
      "insert into org_memberships(org_id, user_id, role) values($1,$2,$3) on conflict (org_id, user_id) do nothing",
      [orgId, userId, "owner"]
    );

    const workspace = await ensurePrimaryWorkspace(orgId, userId, "owner");

    await q(
      `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata)
       values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       on conflict (org_id, user_id)
       do update set
         mailbox_email=excluded.mailbox_email,
         display_name=excluded.display_name,
         provider=excluded.provider,
         outbound_enabled=excluded.outbound_enabled,
         inbound_enabled=excluded.inbound_enabled,
         updated_at=now()`,
      [
        orgId,
        userId,
        normalizedEmail,
        normalizedOrg,
        "gmail_smtp",
        true,
        true,
        JSON.stringify({ source: "auth-signup" }),
      ]
    );

    // Auto-provision one kAIxU generate token at signup.
    const plaintextToken = mintApiToken();
    const tokenPrefix = plaintextToken.slice(0, 14);
    const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    await q(
      "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [
        orgId,
        userId,
        "signup-auto-1",
        tokenHash(plaintextToken),
        tokenPrefix,
        tokenExpiresAt,
        normalizedEmail,
        JSON.stringify(["generate"]),
      ]
    );

    let deliveryMeta: { provider: string; id: string | null };
    try {
      deliveryMeta = await sendMail({
        to: normalizedRecoveryEmail,
        subject: "Your SKYEMAIL account is ready",
        text: [
          `Welcome to ${normalizedOrg}.`,
          `Primary SKYEMAIL login: ${normalizedEmail}`,
          `Backup recovery email: ${normalizedRecoveryEmail}`,
          "Your account, session, and kAIxU key are active.",
          "Password recovery links will be sent to this backup recovery email.",
          "SkyeMail mailbox routing is provisioned for your SKYEMAIL login.",
        ].join("\n"),
      });
    } catch (error: any) {
      await q("delete from orgs where id=$1", [orgId]);
      await audit(normalizedEmail, orgId, null, "auth.signup.delivery_failed", {
        org: normalizedOrg,
        recovery_email: normalizedRecoveryEmail,
        error: String(error?.message || "mail delivery failed"),
        cleanup: "org_deleted",
      });
      return json(502, {
        error: error?.message || "Signup email delivery failed.",
      });
    }

    const sess = await createSession(userId);
    const orgSummary = await getOrgSeatSummary(orgId);

    await audit(normalizedEmail, orgId, null, "auth.signup", {
      org: normalizedOrg,
      recovery_email: normalizedRecoveryEmail,
      default_workspace_id: workspace.id,
      default_workspace_name: workspace.name,
      auto_token_issued: true,
      token_label: "signup-auto-1",
      token_scope: "generate",
      skymail_account_provisioned: true,
      delivery: deliveryMeta.provider,
      provider_message_id: deliveryMeta.id,
    });

    return json(
      200,
      {
        ok: true,
        kaixu_token: {
          token: plaintextToken,
          label: "signup-auto-1",
          locked_email: normalizedEmail,
          scopes: ["generate"],
          expires_at: tokenExpiresAt,
        },
        user: {
          email: normalizedEmail,
          recovery_email: normalizedRecoveryEmail,
          org_id: orgId,
          workspace_id: workspace.id,
          role: "owner",
          has_pin: false,
        },
        org: orgSummary,
        workspace,
        warning: "kAIxU token is shown once on signup. Store it now.",
      },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires, event) }
    );
  } catch (e: any) {
    if (String(e?.code || "") === "23505") {
      return json(409, { error: "Account already exists. Sign in instead." });
    }
    return json(500, { error: "Signup failed." });
  }
};