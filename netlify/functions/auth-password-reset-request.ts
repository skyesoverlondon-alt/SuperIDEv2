import crypto from "crypto";
import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { hasMailDeliveryConfig, sendMail } from "./_shared/mailer";
import { ensureUserRecoveryEmailColumn } from "./_shared/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function ensurePasswordResetTable() {
  await q(
    `create table if not exists password_reset_tokens (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null references users(id) on delete cascade,
       token_hash text not null unique,
       expires_at timestamptz not null,
       used_at timestamptz,
       requested_ip text,
       user_agent text,
       created_at timestamptz not null default now()
     )`,
    []
  );
  await q("create index if not exists idx_password_reset_tokens_user on password_reset_tokens(user_id, created_at desc)", []);
  await q("create index if not exists idx_password_reset_tokens_expiry on password_reset_tokens(expires_at, used_at)", []);
}

function buildBaseUrl(event: any): string {
  const proto = String(event?.headers?.["x-forwarded-proto"] || event?.headers?.["X-Forwarded-Proto"] || "https").trim() || "https";
  const host = String(event?.headers?.host || event?.headers?.Host || "").trim();
  if (!host) return "https://localhost";
  return `${proto}://${host}`;
}

export const handler = async (event: any) => {
  try {
    await ensurePasswordResetTable();
    await ensureUserRecoveryEmailColumn();

    if (!hasMailDeliveryConfig()) {
      return json(503, {
        error: "Password reset email delivery is not configured. Set SMTP_* or RESEND_API_KEY and try again.",
      });
    }

    const body = JSON.parse(event.body || "{}");
    const normalizedEmail = String(body?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }

    const userRes = await q(
      `select id, email, recovery_email, org_id
       from users
       where lower(coalesce(recovery_email, ''))=lower($1)
       limit 1`,
      [normalizedEmail]
    );

    // Always return success to prevent account enumeration.
    const generic = {
      ok: true,
      message: "If that account exists, a reset link has been sent.",
    };

    if (!userRes.rows.length) {
      await audit(normalizedEmail, null, null, "auth.password_reset.request.unknown", {});
      return json(200, generic);
    }

    const user = userRes.rows[0];
    const recoveryEmail = String(user.recovery_email || "").trim().toLowerCase();
    if (!recoveryEmail) {
      await audit(normalizedEmail, user.org_id || null, null, "auth.password_reset.request.missing_recovery_email", {
        requested_identifier: normalizedEmail,
      });
      return json(200, generic);
    }

    const deliveryEmail = recoveryEmail;
    const token = base64url(crypto.randomBytes(32));
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await q(
      `insert into password_reset_tokens(user_id, token_hash, expires_at, requested_ip, user_agent)
       values($1,$2,$3,$4,$5)`,
      [
        user.id,
        tokenHash,
        expiresAt,
        String(event?.headers?.["x-nf-client-connection-ip"] || event?.headers?.["client-ip"] || ""),
        String(event?.headers?.["user-agent"] || ""),
      ]
    );

    const resetLink = `${buildBaseUrl(event)}/recover-account/?reset_email=${encodeURIComponent(recoveryEmail)}&reset_token=${encodeURIComponent(token)}`;

    let deliveryMeta: { provider: string; id: string | null };
    try {
      deliveryMeta = await sendMail({
        to: deliveryEmail,
        subject: "SKYEMAIL Password Reset",
        text: [
          "You requested a password reset for your SKYEMAIL account.",
          `Primary SKYEMAIL login: ${String(user.email || "").trim().toLowerCase()}`,
          recoveryEmail ? `Backup recovery email: ${recoveryEmail}` : "",
          "",
          `Reset link: ${resetLink}`,
          `Reset token: ${token}`,
          "",
          "This token expires in 30 minutes and can be used only once.",
          "If you did not request this reset, ignore this email.",
        ].join("\n"),
      });
    } catch (error: any) {
      await audit(normalizedEmail, user.org_id || null, null, "auth.password_reset.request.delivery_failed", {
        delivery_email: deliveryEmail,
        requested_identifier: normalizedEmail,
        error: String(error?.message || "mail delivery failed"),
      });
      return json(502, {
        error: error?.message || "Password reset email delivery failed.",
      });
    }

    await audit(normalizedEmail, user.org_id || null, null, "auth.password_reset.request", {
      expires_at: expiresAt,
      delivery: deliveryMeta.provider,
      provider_message_id: deliveryMeta.id,
      delivery_email: deliveryEmail,
      requested_identifier: normalizedEmail,
    });

    return json(200, generic);
  } catch {
    return json(500, { error: "Password reset request failed." });
  }
};
