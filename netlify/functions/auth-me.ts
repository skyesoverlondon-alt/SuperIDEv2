import { json } from "./_shared/response";
import { requireUser, ensureUserRecoveryEmailColumn, ensureUserPinColumns } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  await ensureUserRecoveryEmailColumn();
  await ensureUserPinColumns();
  const u = await requireUser(event);
  if (!u) return json(200, null);
  let role: string | null = null;
  let recoveryEmail = "";
  if (u.org_id) {
    const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [u.org_id, u.user_id]);
    role = r.rows[0]?.role || null;
  }
  const userRow = await q("select recovery_email, pin_hash, pin_updated_at from users where id=$1 limit 1", [u.user_id]);
  recoveryEmail = String(userRow.rows[0]?.recovery_email || "");
  return json(200, {
    id: u.user_id,
    email: u.email,
    recovery_email: recoveryEmail,
    has_pin: Boolean(String(userRow.rows[0]?.pin_hash || "").trim()),
    pin_updated_at: userRow.rows[0]?.pin_updated_at || null,
    org_id: u.org_id,
    role,
  });
};