import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { getOrgSeatSummary } from "./_shared/orgs";

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

  const seatSummary = await getOrgSeatSummary(u.org_id);
  const defaultWorkspace = await q(
    `select id, name, created_at, updated_at
     from workspaces
     where org_id=$1
     order by created_at asc
     limit 1`,
    [u.org_id]
  );

  return json(200, {
    ok: true,
    members: rows.rows,
    org: seatSummary,
    workspace: defaultWorkspace.rows[0] || null,
  });
};
