import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (_event: any) => {
  const u = await requireUser(_event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const res = await q(
    "select id, label, prefix, locked_email, scopes_json, status, created_at, expires_at, last_used_at from api_tokens where org_id=$1 order by created_at desc limit 1000",
    [u.org_id]
  );
  return json(200, { ok: true, tokens: res.rows });
};
