import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { hashPassword, createSession, setSessionCookie } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";

export const handler = async (event: any) => {
  try {
    const { email, password, orgName } = JSON.parse(event.body || "{}");
    if (!email || !password || !orgName) {
      return json(400, { error: "Missing fields." });
    }
    // Create org
    const org = await q(
      "insert into orgs(name) values($1) returning id,name",
      [orgName]
    );
    const orgId = org.rows[0].id;
    // Hash password
    const pwHash = await hashPassword(password);
    const userRow = await q(
      "insert into users(email,password_hash,org_id) values($1,$2,$3) returning id,email,org_id",
      [email.toLowerCase(), pwHash, orgId]
    );
    const userId = userRow.rows[0].id;
    await q(
      "insert into org_memberships(org_id, user_id, role) values($1,$2,$3) on conflict (org_id, user_id) do nothing",
      [orgId, userId, "owner"]
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
        email.toLowerCase(),
        JSON.stringify(["generate"]),
      ]
    );

    // Create session
    const sess = await createSession(userId);
    // Audit
    await audit(email.toLowerCase(), orgId, null, "auth.signup", {
      org: orgName,
      auto_token_issued: true,
      token_label: "signup-auto-1",
      token_scope: "generate",
    });
    return json(
      200,
      {
        ok: true,
        kaixu_token: {
          token: plaintextToken,
          label: "signup-auto-1",
          locked_email: email.toLowerCase(),
          scopes: ["generate"],
          expires_at: tokenExpiresAt,
        },
        warning: "kAIxU token is shown once on signup. Store it now.",
      },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires) }
    );
  } catch (e: any) {
    return json(500, { error: e?.message || "Signup failed." });
  }
};