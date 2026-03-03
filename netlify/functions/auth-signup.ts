import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { hashPassword, createSession, setSessionCookie } from "./_shared/auth";
import { audit } from "./_shared/audit";

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
    // Create session
    const sess = await createSession(userId);
    // Audit
    await audit(email.toLowerCase(), orgId, null, "auth.signup", { org: orgName });
    return json(
      200,
      { ok: true },
      { "Set-Cookie": setSessionCookie(sess.token, sess.expires) }
    );
  } catch (e: any) {
    return json(500, { error: e?.message || "Signup failed." });
  }
};