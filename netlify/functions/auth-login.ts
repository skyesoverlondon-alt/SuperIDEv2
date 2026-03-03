import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { verifyPassword, createSession, setSessionCookie } from "./_shared/auth";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  try {
    const { email, password } = JSON.parse(event.body || "{}");
    if (!email || !password) {
      return json(400, { error: "Missing fields." });
    }
    const res = await q(
      "select id,email,password_hash,org_id from users where email=$1",
      [email.toLowerCase()]
    );
    if (!res.rows.length) {
      return json(401, { error: "Invalid credentials." });
    }
    const user = res.rows[0];
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return json(401, { error: "Invalid credentials." });
    }
    const sess = await createSession(user.id);
    await audit(user.email, user.org_id, null, "auth.login", {});
    return json(
      200,
      { ok: true },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires) }
    );
  } catch (e: any) {
    return json(500, { error: e?.message || "Login failed." });
  }
};