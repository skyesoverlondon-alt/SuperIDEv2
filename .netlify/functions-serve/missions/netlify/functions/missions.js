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

// netlify/functions/missions.ts
var missions_exports = {};
__export(missions_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(missions_exports);

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

// netlify/functions/_shared/correlation.ts
function readCorrelationId(event) {
  const raw = event?.headers?.["x-correlation-id"] || event?.headers?.["X-Correlation-Id"] || event?.headers?.["x_correlation_id"] || "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
}

// netlify/functions/missions.ts
function parseLimit(raw) {
  const n = Number(raw || 12);
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}
function clampList(input, limit, maxLength) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit).map((item) => item.length > maxLength ? item.slice(0, maxLength) : item);
}
var handler = async (event) => {
  const method = String(event?.httpMethod || "GET").toUpperCase();
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  if (method === "GET") {
    const params = event?.queryStringParameters || {};
    const wsId2 = String(params.ws_id || "").trim();
    const status2 = String(params.status || "").trim().toLowerCase();
    const limit = parseLimit(params.limit);
    if (wsId2) {
      const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId2);
      if (!allowed) return json(403, { error: "Workspace read denied." });
    }
    const clauses = ["m.org_id=$1"];
    const args = [u.org_id];
    let idx = 2;
    if (wsId2) {
      clauses.push(`m.ws_id=$${idx++}`);
      args.push(wsId2);
    }
    if (status2) {
      clauses.push(`m.status=$${idx++}`);
      args.push(status2);
    }
    args.push(limit);
    const result = await q(
      `select m.id, m.ws_id, m.title, m.status, m.priority, m.owner_user_id,
              m.goals_json, m.linked_apps_json, m.variables_json, m.entitlement_snapshot,
              m.created_at, m.updated_at,
              coalesce(mc.collaborator_count, 0) as collaborator_count,
              coalesce(ma.asset_count, 0) as asset_count
         from missions m
         left join (
           select mission_id, count(*)::int as collaborator_count
             from mission_collaborators
            group by mission_id
         ) mc on mc.mission_id = m.id
         left join (
           select mission_id, count(*)::int as asset_count
             from mission_assets
            group by mission_id
         ) ma on ma.mission_id = m.id
        where ${clauses.join(" and ")}
        order by m.updated_at desc
        limit $${idx}`,
      args
    );
    return json(200, { ok: true, items: result.rows });
  }
  if (method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const title = String(body.title || "").trim();
  const wsId = String(body.ws_id || "").trim();
  const status = String(body.status || "active").trim().toLowerCase();
  const priority = String(body.priority || "medium").trim().toLowerCase();
  const goals = clampList(body.goals, 10, 240);
  const linkedApps = clampList(body.linked_apps, 12, 80);
  const note = String(body.note || "").trim();
  const correlationId = readCorrelationId(event);
  if (!title) return json(400, { error: "Missing title." });
  if (wsId) {
    const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace write denied." });
  }
  const allowedStatuses = /* @__PURE__ */ new Set(["draft", "active", "blocked", "completed", "archived"]);
  const allowedPriorities = /* @__PURE__ */ new Set(["low", "medium", "high", "critical"]);
  const normalizedStatus = allowedStatuses.has(status) ? status : "active";
  const normalizedPriority = allowedPriorities.has(priority) ? priority : "medium";
  const inserted = await q(
    `insert into missions(
       org_id, ws_id, title, status, priority, owner_user_id,
       goals_json, linked_apps_json, variables_json, entitlement_snapshot
     )
     values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
     returning id, created_at, updated_at`,
    [
      u.org_id,
      wsId || null,
      title,
      normalizedStatus,
      normalizedPriority,
      u.user_id,
      JSON.stringify(goals),
      JSON.stringify(linkedApps),
      JSON.stringify(note ? { note } : {}),
      JSON.stringify({ issued_by: u.email, created_at: (/* @__PURE__ */ new Date()).toISOString() })
    ]
  );
  const missionId = inserted.rows[0]?.id || null;
  if (missionId) {
    await q(
      `insert into mission_collaborators(mission_id, user_id, email, role, added_by)
       values($1,$2,$3,'owner',$4)
       on conflict do nothing`,
      [missionId, u.user_id, u.email, u.user_id]
    );
  }
  await audit(u.email, u.org_id, wsId || null, "mission.create", {
    mission_id: missionId,
    title,
    status: normalizedStatus,
    priority: normalizedPriority,
    goals_count: goals.length,
    linked_apps: linkedApps,
    correlation_id: correlationId || null
  });
  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId: wsId || null,
    missionId,
    eventType: "mission.created",
    sourceApp: "SkyeTasks",
    sourceRoute: "/api/missions",
    subjectKind: "mission",
    subjectId: String(missionId || ""),
    severity: "info",
    summary: `Mission created: ${title}`,
    correlationId,
    payload: {
      title,
      status: normalizedStatus,
      priority: normalizedPriority,
      goals,
      linked_apps: linkedApps,
      note: note || null
    }
  });
  return json(200, {
    ok: true,
    id: missionId,
    title,
    ws_id: wsId || null,
    status: normalizedStatus,
    priority: normalizedPriority,
    created_at: inserted.rows[0]?.created_at || null,
    updated_at: inserted.rows[0]?.updated_at || null
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=missions.js.map
