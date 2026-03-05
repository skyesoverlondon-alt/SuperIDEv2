import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { readCorrelationId } from "./_shared/correlation";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const app = String(body.app || "unknown").trim().slice(0, 64);
  const action = String(body.action || "unknown").trim().slice(0, 64);
  const outcome = String(body.outcome || "unknown").trim().slice(0, 32);
  const errorCode = String(body.error_code || "").trim().slice(0, 64);
  const wsId = String(body.ws_id || "").trim() || null;
  const durationMs = Number(body.duration_ms || 0);
  const context = typeof body.context === "object" && body.context ? body.context : {};
  const correlationId = readCorrelationId(event);

  await audit(u.email, u.org_id, wsId, "client.telemetry", {
    app,
    action,
    outcome,
    duration_ms: Number.isFinite(durationMs) ? Math.max(0, Math.trunc(durationMs)) : 0,
    error_code: errorCode || null,
    correlation_id: correlationId || null,
    context,
  });

  return json(200, { ok: true });
};
