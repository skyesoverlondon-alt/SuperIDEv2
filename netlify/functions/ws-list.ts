import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(200, []);
  const r = await q(
    "select id,org_id,name,created_at,updated_at from workspaces where org_id=$1 order by updated_at desc",
    [u.org_id]
  );
  return json(200, r.rows);
};