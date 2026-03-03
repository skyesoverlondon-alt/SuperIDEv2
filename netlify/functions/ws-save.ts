import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  const { id, files } = JSON.parse(event.body || "{}");
  if (!id || !Array.isArray(files)) {
    return json(400, { error: "Invalid payload." });
  }
  // Fetch workspace to check org
  const r0 = await q("select org_id from workspaces where id=$1", [id]);
  if (!r0.rows.length) return json(404, { error: "Not found." });
  if (r0.rows[0].org_id !== u.org_id) return forbid();
  await q(
    "update workspaces set files_json=$1::jsonb, updated_at=now() where id=$2",
    [JSON.stringify(files), id]
  );
  await audit(u.email, u.org_id, id, "ws.save", { files: files.length });
  return json(200, { ok: true });
};