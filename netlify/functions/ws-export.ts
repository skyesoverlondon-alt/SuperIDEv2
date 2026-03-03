import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { runnerCall } from "./_shared/runner";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: "Missing id." });
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