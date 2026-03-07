import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { hashPassword, createSession, setSessionCookie } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";
import { sendMail } from "./_shared/mailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event: any) => {
  try {
    const { email, password, orgName } = JSON.parse(event.body || "{}");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedOrg = String(orgName || "").trim();
    const rawPassword = String(password || "");

    if (!normalizedEmail || !rawPassword || !normalizedOrg) {
      return json(400, { error: "Email, password, and organization name are required." });
    }

    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }

    if (rawPassword.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }

    if (normalizedOrg.length < 2) {
      return json(400, { error: "Organization name must be at least 2 characters." });
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
       insert into users(email,password_hash,org_id)
       select $2, $3, id from created_org
       returning id,email,org_id`,
      [normalizedOrg, normalizedEmail, pwHash]
    );

    const orgId = userRow.rows[0].org_id;
    const userId = userRow.rows[0].id;

    await q(
      "insert into org_memberships(org_id, user_id, role) values($1,$2,$3) on conflict (org_id, user_id) do nothing",
      [orgId, userId, "owner"]
    );

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

    const sess = await createSession(userId);
    await audit(normalizedEmail, orgId, null, "auth.signup", {
      org: normalizedOrg,
      auto_token_issued: true,
      token_label: "signup-auto-1",
      token_scope: "generate",
      skymail_account_provisioned: true,
    });

    try {
      await sendMail({
        to: normalizedEmail,
        subject: "Welcome to SkyeIDE",
        text: [
          `Welcome to ${normalizedOrg}.`,
          "Your account, session, and kAIxU key are active.",
          "SkyeMail mailbox routing is provisioned for this email.",
        ].join("\n"),
      });
    } catch {
      // Non-blocking: signup should succeed even if mail provider is temporarily unavailable.
    }
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
          org_id: orgId,
          role: "owner",
        },
        warning: "kAIxU token is shown once on signup. Store it now.",
      },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires) }
    );
  } catch (e: any) {
    if (String(e?.code || "") === "23505") {
      return json(409, { error: "Account already exists. Sign in instead." });
    }
    return json(500, { error: "Signup failed." });
  }
};