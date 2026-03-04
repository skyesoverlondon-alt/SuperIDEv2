import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { runnerCall } from "./_shared/runner";
import { audit } from "./_shared/audit";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: "Missing id." });
  const ws = await q("select org_id from workspaces where id=$1", [id]);
  if (!ws.rows.length) return json(404, { error: "Not found." });
  if (ws.rows[0].org_id !== u.org_id) return forbid();
  const canRead = await canReadWorkspace(u.org_id as string, u.user_id, id);
  if (!canRead) return json(403, { error: "Forbidden: no workspace access." });
  await audit(u.email, u.org_id, id, "ws.export.requested", {});
  const out = await runnerCall<{
    filename: string;
    base64: string;
    bytes: number;
  }>("/v1/ws/export", {
    user_id: u.user_id,
    org_id: u.org_id,
    ws_id: id,
  });
  await audit(u.email, u.org_id, id, "ws.export.ok", {
    filename: out.filename,
    bytes: out.bytes,
  });
  return json(200, out);
};