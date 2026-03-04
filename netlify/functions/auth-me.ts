import { json } from "./_shared/response";
import { requireUser } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return json(200, null);
  let role: string | null = null;
  if (u.org_id) {
    const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [u.org_id, u.user_id]);
    role = r.rows[0]?.role || null;
  }
  return json(200, {
    id: u.user_id,
    email: u.email,
    org_id: u.org_id,
    role,
  });
};