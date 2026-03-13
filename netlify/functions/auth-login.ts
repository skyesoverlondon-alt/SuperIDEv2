import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { verifyPassword, createSession, setSessionCookie, ensureUserRecoveryEmailColumn, ensureUserPinColumns } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { getOrgRole } from "./_shared/rbac";
import { ensurePrimaryWorkspace, getOrgSeatSummary } from "./_shared/orgs";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event: any) => {
  try {
    await ensureUserRecoveryEmailColumn();
    await ensureUserPinColumns();

    const { email, identifier, login, password } = JSON.parse(event.body || "{}");
    const normalizedEmail = String(identifier || login || email || "").trim().toLowerCase();
    const rawPassword = String(password || "");

    if (!normalizedEmail || !rawPassword) {
      return json(400, { error: "Email and password are required." });
    }

    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }

    const res = await q(
      `select id,email,recovery_email,pin_hash,password_hash,org_id
         from users
        where lower(email)=lower($1)
           or lower(coalesce(recovery_email, ''))=lower($1)
        order by case when lower(email)=lower($1) then 0 else 1 end
        limit 2`,
      [normalizedEmail]
    );
    if (!res.rows.length) {
      return json(401, { error: "Invalid credentials." });
    }
    if (res.rows.length > 1 && String(res.rows[0]?.email || "").trim().toLowerCase() !== normalizedEmail) {
      return json(409, { error: "Multiple accounts match that recovery email. Sign in with the SKYEMAIL primary login instead." });
    }
    const user = res.rows[0];
    const ok = await verifyPassword(rawPassword, user.password_hash);
    if (!ok) {
      return json(401, { error: "Invalid credentials." });
    }

    const identifierType = String(user.email || "").trim().toLowerCase() === normalizedEmail ? "primary_email" : "recovery_email";

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

      await q(
        "update api_tokens set status='revoked', revoked_at=now() where org_id=$1 and issued_by=$2 and status='active' and label like 'login-auto%'",
        [user.org_id, user.id]
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

    let loginToken: { token: string; label: string; locked_email: string; scopes: string[]; expires_at: string } | null = null;
    if (user.org_id) {
      const token = mintApiToken();
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const label = `login-auto-${new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "")}`;
      await q(
        "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [user.org_id, user.id, label, tokenHash(token), token.slice(0, 14), expiresAt, user.email, JSON.stringify(["generate"])]
      );
      loginToken = {
        token,
        label,
        locked_email: String(user.email || "").trim().toLowerCase(),
        scopes: ["generate"],
        expires_at: expiresAt,
      };
    }

    const sess = await createSession(user.id);
    await audit(user.email, user.org_id, null, "auth.login", {
      identifier_type: identifierType,
      identifier_value: normalizedEmail,
      auto_token_issued: Boolean(loginToken),
      token_label: loginToken?.label || null,
    });
    return json(
      200,
      {
        ok: true,
        kaixu_token: loginToken,
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
          key_required: !loginToken,
          pin_configured: Boolean(String(user.pin_hash || "").trim()),
          message: loginToken
            ? "Password login restored the session and issued a reusable kAIxU key for this origin."
            : "Issue a kAIxU key at login if no active key is loaded in this client.",
        },
      },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires, event) }
    );
  } catch (e: any) {
    return json(500, { error: "Login failed." });
  }
};