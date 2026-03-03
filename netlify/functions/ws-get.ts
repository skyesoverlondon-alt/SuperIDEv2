import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

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
  return json(200, { files: r.rows[0].files_json || [] });
};