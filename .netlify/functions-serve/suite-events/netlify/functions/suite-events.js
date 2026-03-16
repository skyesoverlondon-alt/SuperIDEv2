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

// netlify/functions/suite-events.ts
var suite_events_exports = {};
__export(suite_events_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(suite_events_exports);

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

// netlify/functions/_shared/rbac.ts
async function getOrgRole(orgId, userId) {
  const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [orgId, userId]);
  return r.rows[0]?.role || null;
}
async function getWorkspaceRole(wsId, userId) {
  const r = await q("select role from workspace_memberships where ws_id=$1 and user_id=$2 limit 1", [wsId, userId]);
  return r.rows[0]?.role || null;
}
async function canReadWorkspace(orgId, userId, wsId) {
  const orgRole = await getOrgRole(orgId, userId);
  if (!orgRole) return false;
  if (orgRole === "owner" || orgRole === "admin") return true;
  const wsRole = await getWorkspaceRole(wsId, userId);
  if (wsRole) return true;
  const c = await q("select count(*)::int as c from workspace_memberships where ws_id=$1", [wsId]);
  const hasScopedMemberships = Number(c.rows[0]?.c || 0) > 0;
  if (!hasScopedMemberships) return true;
  return false;
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

// netlify/functions/_shared/correlation.ts
function readCorrelationId(event) {
  const raw = event?.headers?.["x-correlation-id"] || event?.headers?.["X-Correlation-Id"] || event?.headers?.["x_correlation_id"] || "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
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

// netlify/functions/suite-events.ts
function parseLimit(raw) {
  const n = Number(raw || 40);
  if (!Number.isFinite(n)) return 40;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100);
}
function normalizeStatus(raw) {
  const value = String(raw || "requested").trim().toLowerCase();
  if (value === "queued" || value === "completed" || value === "failed") return value;
  return "requested";
}
function normalizeIntent(raw) {
  const input = typeof raw === "string" ? { name: raw } : asRecord(raw);
  const name = String(input.name || "open-proof").trim().toLowerCase();
  return {
    name: name || "open-proof",
    version: "suite-intent-v1",
    status: normalizeStatus(input.status),
    summary: input.summary ? String(input.summary).trim() : null
  };
}
function normalizeContext(raw, wsId) {
  const input = asRecord(raw);
  return {
    workspace_id: String(input.workspace_id || input.workspaceId || wsId).trim() || wsId,
    file_ids: asStringList(input.file_ids || input.fileIds),
    thread_id: input.thread_id ? String(input.thread_id).trim() : input.threadId ? String(input.threadId).trim() : null,
    channel_id: input.channel_id ? String(input.channel_id).trim() : input.channelId ? String(input.channelId).trim() : null,
    mission_id: input.mission_id ? String(input.mission_id).trim() : input.missionId ? String(input.missionId).trim() : null,
    draft_id: input.draft_id ? String(input.draft_id).trim() : input.draftId ? String(input.draftId).trim() : null,
    case_id: input.case_id ? String(input.case_id).trim() : input.caseId ? String(input.caseId).trim() : null,
    asset_ids: asStringList(input.asset_ids || input.assetIds)
  };
}
function buildSummary(sourceApp, targetApp, intent, detail) {
  if (detail) return detail;
  if (targetApp) return `${sourceApp} ${intent.status} ${intent.name} -> ${targetApp}`;
  return `${sourceApp} ${intent.status} ${intent.name}`;
}
function normalizeEventRow(row) {
  const payload = asRecord(row?.payload);
  return {
    id: String(row?.id || ""),
    occurred_at: row?.occurred_at || row?.at || null,
    source_app: String(row?.source_app || payload.source_app || "").trim(),
    target_app: String(payload.target_app || "").trim() || null,
    summary: String(row?.summary || payload.detail || "").trim(),
    correlation_id: row?.correlation_id || null,
    idempotency_key: row?.idempotency_key || null,
    intent: normalizeIntent(payload.intent),
    context: normalizeContext(payload.context, String(row?.ws_id || payload.ws_id || "").trim()),
    detail: String(payload.detail || row?.summary || "").trim(),
    payload
  };
}
function deriveAutomations(event) {
  if (event.intent.status !== "completed" || !event.targetApp) return [];
  const baseContext = event.context;
  if (event.sourceApp === "SkyeDocxPro" && event.targetApp === "SkyeMail" && event.intent.name === "compose-mail") {
    return [
      {
        source_app: "SkyeMail",
        target_app: "SkyeChat",
        intent: { name: "open-thread", version: "suite-intent-v1", status: "queued", summary: "Carry the document follow-up into the command room." },
        context: { ...baseContext, channel_id: baseContext.channel_id || "docx-review" },
        detail: "Automation queued: SkyeMail follow-up thread for the document handoff."
      }
    ];
  }
  if (event.sourceApp === "SkyDex4.6" && event.targetApp === "SovereignVariables" && event.intent.name === "sync-case") {
    return [
      {
        source_app: "SovereignVariables",
        target_app: "SkyeAnalytics",
        intent: { name: "open-proof", version: "suite-intent-v1", status: "queued", summary: "Open proof and telemetry after environment sync." },
        context: baseContext,
        detail: "Automation queued: review suite proof in SkyeAnalytics after the SkyDex sync."
      }
    ];
  }
  if (event.sourceApp === "AE-Flow" && event.targetApp === "SkyeMail" && event.intent.name === "compose-mail") {
    return [
      {
        source_app: "SkyeMail",
        target_app: "SkyeAdmin",
        intent: { name: "escalate-admin", version: "suite-intent-v1", status: "queued", summary: "Escalate the AE handoff to admin review." },
        context: baseContext,
        detail: "Automation queued: AE handoff escalated into SkyeAdmin."
      }
    ];
  }
  if (event.sourceApp === "GoogleBusinessProfileRescuePlatform" && event.targetApp === "Neural-Space-Pro" && event.intent.name === "launch-neural") {
    return [
      {
        source_app: "Neural-Space-Pro",
        target_app: "SkyeMail",
        intent: { name: "compose-mail", version: "suite-intent-v1", status: "queued", summary: "Draft the external rescue follow-up in mail." },
        context: baseContext,
        detail: "Automation queued: rescue follow-up draft in SkyeMail."
      }
    ];
  }
  if (event.sourceApp === "Neural-Space-Pro" && event.targetApp === "SkyeMail" && event.intent.name === "compose-mail") {
    return [
      {
        source_app: "SkyeMail",
        target_app: "SkyeChat",
        intent: { name: "open-thread", version: "suite-intent-v1", status: "queued", summary: "Move the rescue execution into the team room." },
        context: { ...baseContext, channel_id: baseContext.channel_id || "rescue-ops" },
        detail: "Automation queued: rescue execution thread in SkyeChat."
      }
    ];
  }
  return [];
}
async function writeSuiteEvent(options) {
  const summary = buildSummary(options.sourceApp, options.targetApp, options.intent, options.detail);
  return emitSovereignEvent({
    actor: options.actor,
    actorUserId: options.actorUserId,
    orgId: options.orgId,
    wsId: options.wsId,
    missionId: options.context.mission_id || null,
    eventType: `suite.intent.${options.intent.status}`,
    sourceApp: options.sourceApp,
    sourceRoute: "/api/suite-events",
    subjectKind: "suite_intent",
    subjectId: `${options.sourceApp}:${options.intent.name}:${options.targetApp || "none"}`,
    severity: options.intent.status === "failed" ? "warning" : "info",
    summary,
    correlationId: options.correlationId,
    idempotencyKey: options.idempotencyKey,
    payload: {
      bridge_schema: "suite-intent-v1",
      source_app: options.sourceApp,
      target_app: options.targetApp,
      intent: options.intent,
      context: options.context,
      detail: options.detail,
      ...options.payload
    }
  });
}
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  if (event.httpMethod === "GET") {
    const params = event?.queryStringParameters || {};
    const wsId2 = String(params.ws_id || "").trim();
    const appId = String(params.app_id || "").trim();
    const limit = parseLimit(params.limit);
    if (!wsId2) return json(400, { error: "Missing ws_id." });
    const allowed2 = await canReadWorkspace(u.org_id, u.user_id, wsId2);
    if (!allowed2) return json(403, { error: "Workspace read denied." });
    const values = [u.org_id, wsId2, limit];
    let appFilterSql = "";
    if (appId) {
      values.splice(2, 0, appId);
      appFilterSql = " and (source_app=$3 or payload->>'target_app'=$3)";
    }
    const rows = await q(
      `select id, occurred_at, ws_id, source_app, summary, correlation_id, idempotency_key, payload
       from sovereign_events
       where org_id=$1
         and ws_id=$2
         and event_type like 'suite.intent.%'${appFilterSql}
       order by occurred_at desc
       limit $${appId ? 4 : 3}`,
      values
    );
    const items = rows.rows.map(normalizeEventRow);
    return json(200, { ok: true, items });
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const wsId = String(body.ws_id || "").trim();
  const sourceApp = String(body.source_app || body.sourceApp || "").trim();
  const targetAppRaw = String(body.target_app || body.targetApp || "").trim();
  const targetApp = targetAppRaw || null;
  const intent = normalizeIntent(body.intent);
  const context = normalizeContext(body.context, wsId);
  const detail = String(body.detail || body.note || intent.summary || "").trim();
  const correlationId = readCorrelationId(event) || (body.correlation_id ? String(body.correlation_id).trim() : null);
  const idempotencyKey = readIdempotencyKey(event, body) || (body.idempotency_key ? String(body.idempotency_key).trim() : null);
  const extraPayload = asRecord(body.payload);
  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!sourceApp) return json(400, { error: "Missing source_app." });
  if (!intent.name) return json(400, { error: "Missing intent name." });
  const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace write denied." });
  const saved = await writeSuiteEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId,
    sourceApp,
    targetApp,
    intent,
    context,
    detail,
    payload: extraPayload,
    correlationId,
    idempotencyKey
  });
  const recommendations = deriveAutomations({ sourceApp, targetApp, intent, context });
  for (let index = 0; index < recommendations.length; index += 1) {
    const recommendation = recommendations[index];
    await writeSuiteEvent({
      actor: u.email,
      actorUserId: u.user_id,
      orgId: u.org_id,
      wsId,
      sourceApp: recommendation.source_app,
      targetApp: recommendation.target_app,
      intent: recommendation.intent,
      context: recommendation.context,
      detail: recommendation.detail,
      payload: {
        automation: {
          derived: true,
          source_event_id: saved?.id || null
        }
      },
      correlationId,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:automation:${index}` : null
    });
  }
  await audit(u.email, u.org_id, wsId, "suite.event.save", {
    source_app: sourceApp,
    target_app: targetApp,
    intent,
    context,
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    event_id: saved?.id || null,
    recommendations: recommendations.length
  });
  return json(200, {
    ok: true,
    item: {
      id: saved?.id || null,
      occurred_at: saved?.occurred_at || null,
      source_app: sourceApp,
      target_app: targetApp,
      intent,
      context,
      detail
    },
    recommendations
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=suite-events.js.map
