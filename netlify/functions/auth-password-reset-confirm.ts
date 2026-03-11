import crypto from "crypto";
import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { hashPassword, ensureUserRecoveryEmailColumn } from "./_shared/auth";
import { audit } from "./_shared/audit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export const handler = async (event: any) => {
  try {
    await ensurePasswordResetTable();
    await ensureUserRecoveryEmailColumn();

    const body = JSON.parse(event.body || "{}");
    const normalizedEmail = String(body?.email || "").trim().toLowerCase();
    const token = String(body?.token || "").trim();
    const newPassword = String(body?.newPassword || "");

    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }
    if (!token || token.length < 16) {
      return json(400, { error: "Reset token is required." });
    }
    if (newPassword.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }

    const nowIso = new Date().toISOString();
    const tokenHash = hashToken(token);

    const lookup = await q(
      `select prt.id as reset_id, prt.user_id, u.email, u.recovery_email, u.org_id
       from password_reset_tokens prt
       join users u on u.id = prt.user_id
       where prt.token_hash=$1
         and prt.used_at is null
         and prt.expires_at > $2
         and lower(coalesce(u.recovery_email, ''))=lower($3)
       limit 1`,
      [tokenHash, nowIso, normalizedEmail]
    );

    if (!lookup.rows.length) {
      return json(400, { error: "Reset token is invalid or expired." });
    }

    const row = lookup.rows[0];
    const pwHash = await hashPassword(newPassword);

    await q("update users set password_hash=$1 where id=$2", [pwHash, row.user_id]);
    await q("update password_reset_tokens set used_at=now() where user_id=$1 and used_at is null", [row.user_id]);
    await q("delete from sessions where user_id=$1", [row.user_id]);

    await audit(normalizedEmail, row.org_id || null, null, "auth.password_reset.confirm", {
      reset_token_id: row.reset_id,
      sessions_revoked: true,
    });

    return json(200, {
      ok: true,
      message: "Password reset complete. Sign in with your new password.",
    });
  } catch {
    return json(500, { error: "Password reset failed." });
  }
};
