import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { verifyPassword, createSession, setSessionCookie } from "./_shared/auth";
import { audit } from "./_shared/audit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event: any) => {
  try {
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
      "select id,email,password_hash,org_id from users where email=$1",
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
    const sess = await createSession(user.id);
    await audit(user.email, user.org_id, null, "auth.login", {});
    return json(
      200,
      {
        ok: true,
        user: {
          email: user.email,
          org_id: user.org_id,
        },
        onboarding: {
          key_required: true,
          message: "Issue a kAIxU key at login if no active key is loaded in this client.",
        },
      },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires) }
    );
  } catch (e: any) {
    return json(500, { error: "Login failed." });
  }
};