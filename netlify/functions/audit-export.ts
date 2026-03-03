import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { audit as emit } from "./_shared/audit";
import { runnerCall } from "./_shared/runner";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  const ws_id = event.queryStringParameters?.ws_id || null;
  // POST: log client-side events
  if (event.httpMethod === "POST") {
    const { type, meta, ws_id: wid } = JSON.parse(event.body || "{}");
    await emit(u.email, u.org_id, wid || null, type || "client.event", meta || {});
    return json(200, { ok: true });
  }
  // GET: generate evidence pack via runner
  await emit(u.email, u.org_id, ws_id, "evidence.export.requested", {});
  const out = await runnerCall<{
    ok: boolean;
    filename: string;
    bytes: number;
    url: string;
    manifest_sha256: string;
    signature: string;
    expires_at: string;
  }>("/v1/evidence/r2/export", {
    user_id: u.user_id,
    org_id: u.org_id,
    ws_id,
  });
  await emit(u.email, u.org_id, ws_id, "evidence.export.ok", {
    bytes: out.bytes,
    manifest_sha256: out.manifest_sha256,
    expires_at: out.expires_at,
  });
  return json(200, out);
};