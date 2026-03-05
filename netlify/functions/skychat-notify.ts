import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { canReadWorkspace } from "./_shared/rbac";
import { readIdempotencyKey } from "./_shared/idempotency";
import { readCorrelationId } from "./_shared/correlation";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }

  const channel = String(body.channel || "").trim();
  const message = String(body.message || "").trim();
  const source = String(body.source || "manual").trim();
  const wsId = String(body.ws_id || "").trim();
  const idempotencyKey = readIdempotencyKey(event, body);
  const correlationId = readCorrelationId(event);

  if (!channel || !message) {
    return json(400, { error: "Missing channel or message." });
  }

  if (wsId) {
    const canRead = await canReadWorkspace(u.org_id, u.user_id, wsId);
    if (!canRead) return json(403, { error: "Workspace access denied." });
  }

  try {
    if (idempotencyKey) {
      const existing = await q(
        `select id, created_at
         from app_records
         where org_id=$1
           and ws_id is not distinct from $2
           and app='SkyeChat'
           and created_by=$3
           and payload->>'idempotency_key'=$4
         order by created_at desc
         limit 1`,
        [u.org_id, wsId || null, u.user_id, idempotencyKey]
      );
      if (existing.rows.length) {
        return json(200, {
          ok: true,
          duplicate: true,
          id: existing.rows[0]?.id || null,
          created_at: existing.rows[0]?.created_at || null,
        });
      }
    }

    const row = await q(
      "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id, created_at",
      [
        u.org_id,
        wsId || null,
        "SkyeChat",
        `#${channel}`,
        JSON.stringify({ channel, message, source, idempotency_key: idempotencyKey || null }),
        u.user_id,
      ]
    );

    await audit(u.email, u.org_id, wsId || null, "skychat.notify.ok", {
      channel,
      source,
      idempotency_key: idempotencyKey || null,
      correlation_id: correlationId || null,
      record_id: row.rows[0]?.id || null,
    });

    return json(200, { ok: true, id: row.rows[0]?.id || null, created_at: row.rows[0]?.created_at || null });
  } catch (e: any) {
    const msg = e?.message || "SkyeChat notify failed.";
    await audit(u.email, u.org_id, wsId || null, "skychat.notify.failed", {
      channel,
      correlation_id: correlationId || null,
      error: msg,
    });
    return json(500, { error: msg });
  }
};
