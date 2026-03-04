import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }

  const id = String(body.id || "").trim();
  if (!id) return json(400, { error: "Missing token id." });

  const res = await q(
    "update api_tokens set status='revoked' where id=$1 and org_id=$2 returning id, label, prefix, status, revoked_at",
    [id, u.org_id]
  );
  if (!res.rows.length) return json(404, { error: "Token not found." });

  await audit(u.email, u.org_id, null, "token.revoke", { token_id: id, label: res.rows[0].label || null });
  return json(200, { ok: true, token: res.rows[0] });
};
