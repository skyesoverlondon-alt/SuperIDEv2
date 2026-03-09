import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { verifyPassword, createSession, setSessionCookie, ensureUserRecoveryEmailColumn, ensureUserPinColumns } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { getOrgRole } from "./_shared/rbac";
import { ensurePrimaryWorkspace, getOrgSeatSummary } from "./_shared/orgs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event: any) => {
  try {
    await ensureUserRecoveryEmailColumn();
    await ensureUserPinColumns();

    const { email, password } = JSON.parse(event.body || "{}");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const rawPassword = String(password || "");

    if (!normalizedEmail || !rawPassword) {
      return json(400, { error: "Email and password are required." });
    }

    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }

    const res = await q(
      "select id,email,recovery_email,pin_hash,password_hash,org_id from users where email=$1",
      [normalizedEmail]
    );
    if (!res.rows.length) {
      return json(401, { error: "Invalid credentials." });
    }
    const user = res.rows[0];
    const ok = await verifyPassword(rawPassword, user.password_hash);
    if (!ok) {
      return json(401, { error: "Invalid credentials." });
    }

    if (user.org_id) {
      await q(
        `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata)
         values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         on conflict (org_id, user_id) do nothing`,
        [
          user.org_id,
          user.id,
          user.email,
          user.email,
          "gmail_smtp",
          true,
          true,
          JSON.stringify({ source: "auth-login-autoprovision" }),
        ]
      );
    }

    let role: string | null = null;
    let workspace = null;
    let org = null;
    if (user.org_id) {
      role = await getOrgRole(user.org_id, user.id);
      workspace = await ensurePrimaryWorkspace(user.org_id, user.id, role || "member");
      org = await getOrgSeatSummary(user.org_id);
    }

    const sess = await createSession(user.id);
    await audit(user.email, user.org_id, null, "auth.login", {});
    return json(
      200,
      {
        ok: true,
        user: {
          email: user.email,
          recovery_email: user.recovery_email || "",
          org_id: user.org_id,
          workspace_id: workspace?.id || null,
          role,
          has_pin: Boolean(String(user.pin_hash || "").trim()),
        },
        workspace,
        org,
        onboarding: {
          key_required: true,
          pin_configured: Boolean(String(user.pin_hash || "").trim()),
          message: "Issue a kAIxU key at login if no active key is loaded in this client.",
        },
      },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires) }
    );
  } catch (e: any) {
    return json(500, { error: "Login failed." });
  }
};