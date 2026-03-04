import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { getOrgRole } from "./_shared/rbac";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(200, []);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  if (!orgRole) return json(200, []);

  let r;
  if (orgRole === "owner" || orgRole === "admin") {
    r = await q(
      "select id,org_id,name,created_at,updated_at from workspaces where org_id=$1 order by updated_at desc",
      [u.org_id]
    );
  } else {
    r = await q(
      `select w.id,w.org_id,w.name,w.created_at,w.updated_at
       from workspaces w
       left join workspace_memberships wm on wm.ws_id=w.id and wm.user_id=$2
       where w.org_id=$1
         and (
           wm.user_id is not null
           or not exists (select 1 from workspace_memberships wm2 where wm2.ws_id=w.id)
         )
       order by w.updated_at desc`,
      [u.org_id, u.user_id]
    );
  }
  return json(200, r.rows);
};