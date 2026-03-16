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

// netlify/functions/mission-update.ts
var mission_update_exports = {};
__export(mission_update_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(mission_update_exports);

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
var ALLOWED_STATUSES = /* @__PURE__ */ new Set(["draft", "active", "blocked", "completed", "archived"]);
var ALLOWED_PRIORITIES = /* @__PURE__ */ new Set(["low", "medium", "high", "critical"]);
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function clampString(value, maxLength) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}
function isUuidLike(value) {
  return UUID_RE.test(String(value || "").trim());
}
function clampList(input, limit, maxLength) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => clampString(item, maxLength)).filter(Boolean).slice(0, limit);
}
function normalizeMissionStatus(input, fallback) {
  const next = clampString(input, 32).toLowerCase();
  return ALLOWED_STATUSES.has(next) ? next : fallback;
}
function normalizeMissionPriority(input, fallback) {
  const next = clampString(input, 32).toLowerCase();
  return ALLOWED_PRIORITIES.has(next) ? next : fallback;
}
function normalizeObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return { ...input };
}
function readMissionNote(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return clampString(input.note, 4e3);
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

// netlify/functions/mission-update.ts
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
  const missionId = clampString(body.mission_id || body.id, 64);
  if (!missionId) return json(400, { error: "Missing mission_id." });
  if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
  const mission = await loadMission(u.org_id, missionId);
  if (!mission) return json(404, { error: "Mission not found." });
  const allowed = await canWriteMission(u.org_id, u.user_id, mission.ws_id || null);
  if (!allowed) return json(403, { error: "Mission write denied." });
  const titleProvided = Object.prototype.hasOwnProperty.call(body, "title");
  const statusProvided = Object.prototype.hasOwnProperty.call(body, "status");
  const priorityProvided = Object.prototype.hasOwnProperty.call(body, "priority");
  const goalsProvided = Object.prototype.hasOwnProperty.call(body, "goals");
  const linkedAppsProvided = Object.prototype.hasOwnProperty.call(body, "linked_apps");
  const noteProvided = Object.prototype.hasOwnProperty.call(body, "note");
  const variablesProvided = Object.prototype.hasOwnProperty.call(body, "variables");
  if (!titleProvided && !statusProvided && !priorityProvided && !goalsProvided && !linkedAppsProvided && !noteProvided && !variablesProvided) {
    return json(400, { error: "No mission changes provided." });
  }
  const nextTitle = titleProvided ? clampString(body.title, 200) : mission.title;
  if (!nextTitle) return json(400, { error: "Mission title cannot be empty." });
  const nextStatus = statusProvided ? normalizeMissionStatus(body.status, mission.status) : mission.status;
  const nextPriority = priorityProvided ? normalizeMissionPriority(body.priority, mission.priority) : mission.priority;
  const nextGoals = goalsProvided ? clampList(body.goals, 10, 240) : Array.isArray(mission.goals_json) ? mission.goals_json : [];
  const nextLinkedApps = linkedAppsProvided ? clampList(body.linked_apps, 12, 80) : Array.isArray(mission.linked_apps_json) ? mission.linked_apps_json : [];
  const existingVariables = normalizeObject(mission.variables_json);
  const mergedVariables = {
    ...existingVariables,
    ...variablesProvided ? normalizeObject(body.variables) : {}
  };
  if (noteProvided) {
    const note2 = clampString(body.note, 4e3);
    if (note2) mergedVariables.note = note2;
    else delete mergedVariables.note;
  }
  const updated = await q(
    `update missions
        set title=$3,
            status=$4,
            priority=$5,
            goals_json=$6::jsonb,
            linked_apps_json=$7::jsonb,
            variables_json=$8::jsonb,
            updated_at=now()
      where id=$1 and org_id=$2
      returning id, ws_id, title, status, priority, goals_json, linked_apps_json, variables_json, updated_at`,
    [
      missionId,
      u.org_id,
      nextTitle,
      nextStatus,
      nextPriority,
      JSON.stringify(nextGoals),
      JSON.stringify(nextLinkedApps),
      JSON.stringify(mergedVariables)
    ]
  );
  const correlationId = readCorrelationId(event);
  const updatedMission = updated.rows[0] || {};
  const note = readMissionNote(mergedVariables);
  await audit(u.email, u.org_id, mission.ws_id || null, "mission.update", {
    mission_id: missionId,
    title: nextTitle,
    status: nextStatus,
    priority: nextPriority,
    goals_count: nextGoals.length,
    linked_apps: nextLinkedApps,
    correlation_id: correlationId || null
  });
  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId: mission.ws_id || null,
    missionId,
    eventType: "mission.updated",
    sourceApp: "SkyeTasks",
    sourceRoute: "/api/mission-update",
    subjectKind: "mission",
    subjectId: missionId,
    severity: "info",
    summary: `Mission updated: ${nextTitle}`,
    correlationId,
    payload: {
      title: nextTitle,
      status: nextStatus,
      priority: nextPriority,
      goals: nextGoals,
      linked_apps: nextLinkedApps,
      note: note || null
    }
  });
  return json(200, { ok: true, item: updatedMission });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=mission-update.js.map
