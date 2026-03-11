import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { canWriteWorkspace } from "./_shared/rbac";
import { readIdempotencyKey } from "./_shared/idempotency";
import { readCorrelationId } from "./_shared/correlation";
import { emitSovereignEvent } from "./_shared/sovereign-events";
import { ALLOWED_APP_RECORD_APPS } from "./_shared/app-records";

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

  const wsId = String(body.ws_id || "").trim();
  const app = String(body.app || "").trim();
  const title = String(body.title || `${app} Workspace`).trim();
  const model = body.model;
  const idempotencyKey = readIdempotencyKey(event, body);
  const correlationId = readCorrelationId(event);

  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!ALLOWED_APP_RECORD_APPS.has(app)) return json(400, { error: "Unsupported app." });
  if (!model || typeof model !== "object") return json(400, { error: "Missing model payload." });

  const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace write denied." });

  try {
    if (idempotencyKey) {
      const existingByKey = await q(
        `select id, updated_at
         from app_records
         where org_id=$1 and ws_id=$2 and app=$3 and created_by=$4
           and payload->'__meta'->>'idempotency_key'=$5
         order by updated_at desc
         limit 1`,
        [u.org_id, wsId, app, u.user_id, idempotencyKey]
      );
      if (existingByKey.rows.length) {
        return json(200, {
          ok: true,
          duplicate: true,
          record_id: existingByKey.rows[0]?.id || null,
          updated_at: existingByKey.rows[0]?.updated_at || null,
        });
      }
    }

    const modelToSave = idempotencyKey
      ? {
          ...model,
          __meta: {
            ...(typeof model.__meta === "object" && model.__meta ? model.__meta : {}),
            idempotency_key: idempotencyKey,
          },
        }
      : model;

    const existing = await q(
      `select id
       from app_records
       where org_id=$1 and ws_id=$2 and app=$3 and created_by=$4
       order by updated_at desc
       limit 1`,
      [u.org_id, wsId, app, u.user_id]
    );

    const isUpdate = existing.rows.length > 0;
    let saved: any;
    if (existing.rows.length) {
      saved = await q(
        `update app_records
         set title=$1, payload=$2::jsonb, updated_at=now()
         where id=$3 and org_id=$4
         returning id, updated_at`,
        [title, JSON.stringify(modelToSave), existing.rows[0].id, u.org_id]
      );
    } else {
      saved = await q(
        `insert into app_records(org_id, ws_id, app, title, payload, created_by)
         values($1,$2,$3,$4,$5::jsonb,$6)
         returning id, updated_at`,
        [u.org_id, wsId, app, title, JSON.stringify(modelToSave), u.user_id]
      );
    }

    await audit(u.email, u.org_id, wsId, "app.record.save", {
      app,
      idempotency_key: idempotencyKey || null,
      correlation_id: correlationId || null,
      record_id: saved.rows[0]?.id || null,
      title,
    });

    await emitSovereignEvent({
      actor: u.email,
      actorUserId: u.user_id,
      orgId: u.org_id,
      wsId,
      eventType: isUpdate ? "document.updated" : "document.created",
      sourceApp: app,
      sourceRoute: "/api/app-record-save",
      subjectKind: "app_record",
      subjectId: String(saved.rows[0]?.id || ""),
      severity: "info",
      summary: `${app} ${isUpdate ? "updated" : "created"}: ${title}`,
      correlationId,
      idempotencyKey,
      payload: {
        app,
        title,
        record_id: saved.rows[0]?.id || null,
        operation: isUpdate ? "update" : "create",
      },
    });

    return json(200, {
      ok: true,
      record_id: saved.rows[0]?.id || null,
      updated_at: saved.rows[0]?.updated_at || null,
    });
  } catch (error: any) {
    return json(500, { error: error?.message || "App save failed." });
  }
};
