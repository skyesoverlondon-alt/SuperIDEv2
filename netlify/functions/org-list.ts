import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(200, []);
  const r = await q("select id,name from orgs where id=$1", [u.org_id]);
  return json(200, r.rows);
};