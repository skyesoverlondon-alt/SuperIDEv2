"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/app-record-save.ts
var app_record_save_exports = {};
__export(app_record_save_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(app_record_save_exports);

// netlify/functions/_shared/response.ts
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body ?? {})
  };
}

// netlify/functions/_shared/env.ts
function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// netlify/functions/_shared/neon.ts
function toHttpSqlEndpoint(url) {
  if (/^https?:\/\//i.test(url)) {
    return {
      endpoint: url,
      headers: { "Content-Type": "application/json" }
    };
  }
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const parsed = new URL(url);
    const endpoint = `https://${parsed.host}/sql`;
    return {
      endpoint,
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": url
      }
    };
  }
  throw new Error("NEON_DATABASE_URL must be an https SQL endpoint or postgres connection string.");
}
async function q(sql, params = []) {
  const url = must("NEON_DATABASE_URL");
  const target = toHttpSqlEndpoint(url);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify({ query: sql, params })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error: ${text}`);
  }
  return res.json();
}

// netlify/functions/_shared/auth.ts
var COOKIE = "kx_session";
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((p) => {
    const [k, ...rest] = p.trim().split("=");
    out[k] = rest.join("=") || "";
  });
  return out;
}
async function requireUser(event) {
  const cookies = parseCookies(event.headers?.cookie);
  const token = cookies[COOKIE];
  if (!token) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const sess = await q(
    "select s.token, s.user_id, u.email, u.org_id from sessions s join users u on u.id=s.user_id where s.token=$1 and s.expires_at>$2",
    [token, now]
  );
  if (!sess.rows.length) return null;
  return {
    user_id: sess.rows[0].user_id,
    email: sess.rows[0].email,
    org_id: sess.rows[0].org_id
  };
}
function forbid() {
  return json(401, { error: "Unauthorized" });
}

// netlify/functions/_shared/audit.ts
async function audit(actor, org_id, ws_id, type, meta) {
  try {
    await q(
      "insert into audit_events(actor, org_id, ws_id, type, meta) values($1,$2,$3,$4,$5::jsonb)",
      [actor, org_id, ws_id, type, JSON.stringify(meta ?? {})]
    );
  } catch (_) {
  }
}

// netlify/functions/_shared/rbac.ts
async function getOrgRole(orgId, userId) {
  const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [orgId, userId]);
  return r.rows[0]?.role || null;
}
async function getWorkspaceRole(wsId, userId) {
  const r = await q("select role from workspace_memberships where ws_id=$1 and user_id=$2 limit 1", [wsId, userId]);
  return r.rows[0]?.role || null;
}
async function canWriteWorkspace(orgId, userId, wsId) {
  const orgRole = await getOrgRole(orgId, userId);
  if (!orgRole) return false;
  if (orgRole === "owner" || orgRole === "admin") return true;
  const wsRole = await getWorkspaceRole(wsId, userId);
  if (wsRole === "editor") return true;
  if (wsRole === "viewer") return false;
  const c = await q("select count(*)::int as c from workspace_memberships where ws_id=$1", [wsId]);
  const hasScopedMemberships = Number(c.rows[0]?.c || 0) > 0;
  if (!hasScopedMemberships) return orgRole !== "viewer";
  return false;
}

// netlify/functions/_shared/idempotency.ts
function readIdempotencyKey(event, body) {
  const fromHeaderRaw = event?.headers?.["x-idempotency-key"] || event?.headers?.["X-Idempotency-Key"] || event?.headers?.["x_idempotency_key"] || "";
  const fromBodyRaw = body?.idempotency_key || "";
  const key = String(fromHeaderRaw || fromBodyRaw || "").trim();
  if (!key) return "";
  const safe = key.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
  return safe;
}

// netlify/functions/_shared/correlation.ts
function readCorrelationId(event) {
  const raw = event?.headers?.["x-correlation-id"] || event?.headers?.["X-Correlation-Id"] || event?.headers?.["x_correlation_id"] || "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
}

// netlify/functions/_shared/sovereign-events.ts
var import_crypto = __toESM(require("crypto"), 1);
function inferEventFamily(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  const dot = normalized.indexOf(".");
  return dot === -1 ? normalized : normalized.slice(0, dot);
}
function buildInternalSignature(secret, parts) {
  const hmac = import_crypto.default.createHmac("sha256", secret);
  hmac.update(JSON.stringify(parts));
  return hmac.digest("base64url");
}
async function emitSovereignEvent(input) {
  const eventType = String(input.eventType || "").trim().toLowerCase();
  if (!input.orgId || !eventType || !input.actor) return null;
  try {
    if (input.idempotencyKey) {
      const existing = await q(
        `select id, occurred_at
         from sovereign_events
         where org_id=$1
           and event_type=$2
           and ws_id is not distinct from $3
           and idempotency_key=$4
         order by occurred_at desc
         limit 1`,
        [input.orgId, eventType, input.wsId || null, input.idempotencyKey]
      );
      if (existing.rows.length) {
        return {
          id: existing.rows[0]?.id || null,
          occurred_at: existing.rows[0]?.occurred_at || null,
          duplicate: true
        };
      }
    }
    const payload = input.payload ?? {};
    const summary = String(input.summary || "").trim() || null;
    const occurredAt = (/* @__PURE__ */ new Date()).toISOString();
    const secret = String(process.env.RUNNER_SHARED_SECRET || "").trim();
    const internalSignature = secret ? buildInternalSignature(secret, {
      actor: input.actor,
      org_id: input.orgId,
      ws_id: input.wsId || null,
      event_type: eventType,
      occurred_at: occurredAt,
      payload
    }) : null;
    const inserted = await q(
      `insert into sovereign_events(
         occurred_at, org_id, ws_id, mission_id, event_type, event_family,
         source_app, source_route, actor, actor_user_id, subject_kind, subject_id,
         parent_event_id, severity, correlation_id, idempotency_key, internal_signature,
         summary, payload
       )
       values(
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,
         $18,$19::jsonb
       )
       returning id, occurred_at`,
      [
        occurredAt,
        input.orgId,
        input.wsId || null,
        input.missionId || null,
        eventType,
        inferEventFamily(eventType),
        input.sourceApp || null,
        input.sourceRoute || null,
        input.actor,
        input.actorUserId || null,
        input.subjectKind || null,
        input.subjectId || null,
        input.parentEventId || null,
        input.severity || "info",
        input.correlationId || null,
        input.idempotencyKey || null,
        internalSignature,
        summary,
        JSON.stringify(payload)
      ]
    );
    const eventId = inserted.rows[0]?.id || null;
    if (eventId) {
      try {
        await q(
          `insert into timeline_entries(
             at, org_id, ws_id, mission_id, event_id, entry_type, source_app,
             actor, actor_user_id, subject_kind, subject_id, title, summary, detail
           )
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            occurredAt,
            input.orgId,
            input.wsId || null,
            input.missionId || null,
            eventId,
            eventType,
            input.sourceApp || null,
            input.actor,
            input.actorUserId || null,
            input.subjectKind || null,
            input.subjectId || null,
            summary || eventType,
            summary,
            JSON.stringify(payload)
          ]
        );
      } catch {
      }
    }
    return {
      id: eventId,
      occurred_at: inserted.rows[0]?.occurred_at || occurredAt,
      duplicate: false
    };
  } catch {
    return null;
  }
}

// netlify/functions/_shared/app-records.ts
var ALLOWED_APP_RECORD_APPS = /* @__PURE__ */ new Set([
  "GoogleBusinessProfileRescuePlatform",
  "ContractorIncomeVerification",
  "ContractorVerificationSuite",
  "SkyeCalendar",
  "SkyeDrive",
  "SkyeVault",
  "SkyeForms",
  "SkyeNotes",
  "SkyeBlog",
  "SkyeDocxPro",
  "SkyeBookx",
  "SkyePlatinum",
  "SkyeMail",
  "SkyeChat",
  "SovereignVariables",
  "kAIxu-Cinematic",
  "kAIxu-Persona",
  "kAIxu-Mythos",
  "kAIxu-Atlas",
  "kAIxu-Atmos",
  "kAIxu-Bestiary",
  "kAIxu-Forge",
  "kAIxu-Quest",
  "kAIxU-Codex",
  "kAIxU-Faction",
  "kAIxU-Matrix",
  "kAIxU-PrimeCommand",
  "kAIxU-Vision",
  "kAixU-Chronos"
]);

// netlify/functions/app-record-save.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
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
          updated_at: existingByKey.rows[0]?.updated_at || null
        });
      }
    }
    const modelToSave = idempotencyKey ? {
      ...model,
      __meta: {
        ...typeof model.__meta === "object" && model.__meta ? model.__meta : {},
        idempotency_key: idempotencyKey
      }
    } : model;
    const existing = await q(
      `select id
       from app_records
       where org_id=$1 and ws_id=$2 and app=$3 and created_by=$4
       order by updated_at desc
       limit 1`,
      [u.org_id, wsId, app, u.user_id]
    );
    const isUpdate = existing.rows.length > 0;
    let saved;
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
      title
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
        operation: isUpdate ? "update" : "create"
      }
    });
    return json(200, {
      ok: true,
      record_id: saved.rows[0]?.id || null,
      updated_at: saved.rows[0]?.updated_at || null
    });
  } catch (error) {
    return json(500, { error: error?.message || "App save failed." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=app-record-save.js.map
