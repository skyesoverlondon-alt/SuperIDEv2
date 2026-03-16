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

// netlify/functions/neural-session-save.ts
var neural_session_save_exports = {};
__export(neural_session_save_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(neural_session_save_exports);

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

// netlify/functions/_shared/correlation.ts
function readCorrelationId(event) {
  const raw = event?.headers?.["x-correlation-id"] || event?.headers?.["X-Correlation-Id"] || event?.headers?.["x_correlation_id"] || "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
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

// netlify/functions/_shared/mission-control.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function clampString(value, maxLength) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}
function isUuidLike(value) {
  return UUID_RE.test(String(value || "").trim());
}
async function loadMission(orgId, missionId) {
  const result = await q(
    `select id, org_id, ws_id, title, status, priority, owner_user_id,
            goals_json, linked_apps_json, variables_json, entitlement_snapshot,
            created_at, updated_at
       from missions
      where id=$1 and org_id=$2
      limit 1`,
    [missionId, orgId]
  );
  return result.rows[0] || null;
}
async function canWriteMission(orgId, userId, wsId) {
  if (wsId) return canWriteWorkspace(orgId, userId, wsId);
  const orgRole = await getOrgRole(orgId, userId);
  return orgRole === "owner" || orgRole === "admin" || orgRole === "member";
}
async function touchMission(missionId) {
  await q("update missions set updated_at=now() where id=$1", [missionId]);
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

// netlify/functions/neural-session-save.ts
function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((entry) => {
    const row = entry && typeof entry === "object" ? entry : {};
    const role = clampString(row.role, 24) || "user";
    const content = clampString(row.content, 12e4);
    const timestamp = Number(row.timestamp) || Date.now();
    const attachments = Array.isArray(row.attachments) ? row.attachments.slice(0, 12).map((item) => ({
      name: clampString(item?.name, 160),
      type: clampString(item?.type, 40)
    })) : [];
    return { role, content, timestamp, attachments };
  });
}
function normalizeWorkspaceSummary(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input;
  const files = Array.isArray(row.files) ? row.files.slice(0, 24).map((file) => ({
    path: clampString(file?.path, 240),
    size: Number(file?.size) || 0
  })) : [];
  return {
    revision: clampString(row.revision, 120),
    total_chars: Number(row.total_chars) || 0,
    files
  };
}
var handler = async (event) => {
  if (String(event?.httpMethod || "POST").toUpperCase() !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const recordId = clampString(body.id, 64);
  const wsId = clampString(body.ws_id, 64);
  const missionId = clampString(body.mission_id, 64);
  const title = clampString(body.title, 200) || "Neural Session";
  const preview = clampString(body.preview, 500);
  const branchFrom = clampString(body.branch_from, 64);
  const pinned = Boolean(body.pinned);
  const messages = normalizeMessages(body.messages);
  const workspaceSummary = normalizeWorkspaceSummary(body.workspace_summary);
  if (!wsId) return json(400, { error: "Missing ws_id." });
  const workspaceAllowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!workspaceAllowed) return json(403, { error: "Workspace write denied." });
  let mission = null;
  if (missionId) {
    if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
    mission = await loadMission(u.org_id, missionId);
    if (!mission) return json(404, { error: "Mission not found." });
    const missionAllowed = await canWriteMission(u.org_id, u.user_id, mission.ws_id || null);
    if (!missionAllowed) return json(403, { error: "Mission write denied." });
  }
  const payload = {
    schema: "neural-session-v1",
    mission_id: missionId || null,
    branch_from: branchFrom || null,
    preview,
    pinned,
    message_count: messages.length,
    messages,
    workspace_summary: workspaceSummary,
    workspace_file_count: Array.isArray(workspaceSummary?.files) ? workspaceSummary.files.length : 0,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  let saved;
  let isUpdate = false;
  if (recordId) {
    saved = await q(
      `update app_records
          set title=$1,
              ws_id=$2,
              payload=$3::jsonb,
              updated_at=now()
        where id=$4
          and org_id=$5
          and app='NeuralSpacePro'
        returning id, ws_id, title, payload, created_at, updated_at`,
      [title, wsId, JSON.stringify(payload), recordId, u.org_id]
    );
    if (!saved.rows.length) return json(404, { error: "Neural session not found." });
    isUpdate = true;
  } else {
    saved = await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       values($1,$2,'NeuralSpacePro',$3,$4::jsonb,$5)
       returning id, ws_id, title, payload, created_at, updated_at`,
      [u.org_id, wsId, title, JSON.stringify(payload), u.user_id]
    );
  }
  const item = saved.rows[0] || null;
  const correlationId = readCorrelationId(event);
  if (missionId && item?.id) {
    await q(
      `insert into mission_assets(mission_id, source_app, asset_kind, asset_id, title, detail, attached_by)
       values($1,'NeuralSpacePro','neural_session',$2,$3,$4::jsonb,$5)
       on conflict (mission_id, asset_id)
       do update set
         source_app=excluded.source_app,
         asset_kind=excluded.asset_kind,
         title=excluded.title,
         detail=excluded.detail,
         attached_by=excluded.attached_by`,
      [missionId, item.id, title, JSON.stringify({ ws_id: wsId, preview, message_count: messages.length }), u.user_id]
    );
    await touchMission(missionId);
  }
  await audit(u.email, u.org_id, wsId, isUpdate ? "neural.session.update" : "neural.session.create", {
    record_id: item?.id || null,
    mission_id: missionId || null,
    title,
    message_count: messages.length,
    correlation_id: correlationId || null
  });
  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId,
    missionId: missionId || null,
    eventType: isUpdate ? "neural.session.updated" : "neural.session.created",
    sourceApp: "NeuralSpacePro",
    sourceRoute: "/api/neural-session-save",
    subjectKind: "app_record",
    subjectId: String(item?.id || ""),
    severity: "info",
    summary: `Neural session ${isUpdate ? "updated" : "created"}: ${title}`,
    correlationId,
    payload: {
      title,
      mission_id: missionId || null,
      message_count: messages.length,
      preview: preview || null
    }
  });
  return json(200, { ok: true, item });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=neural-session-save.js.map
