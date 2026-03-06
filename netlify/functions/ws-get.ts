import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: "Missing id." });
  const r = await q(
    "select id,org_id,name,files_json,created_at,updated_at from workspaces where id=$1",
    [id]
  );
  if (!r.rows.length) return json(404, { error: "Not found." });
  if (r.rows[0].org_id !== u.org_id) return forbid();
  const canRead = await canReadWorkspace(u.org_id as string, u.user_id, id);
  if (!canRead) return json(403, { error: "Forbidden: no workspace access." });
  return json(200, {
    files: r.rows[0].files_json || [],
    revision: r.rows[0].updated_at || null,
  });
};