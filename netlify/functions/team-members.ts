import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const rows = await q(
    `select m.user_id, u.email, m.role, m.created_at
     from org_memberships m
     join users u on u.id = m.user_id
     where m.org_id=$1
     order by m.created_at asc`,
    [u.org_id]
  );

  return json(200, { ok: true, members: rows.rows });
};
