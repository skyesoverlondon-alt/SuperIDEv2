"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/neural-session-list.ts
var neural_session_list_exports = {};
__export(neural_session_list_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(neural_session_list_exports);

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

// netlify/functions/neural-session-list.ts
function parseLimit(raw) {
  const n = Number(raw || 24);
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}
function summarizePayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const messages = Array.isArray(safePayload.messages) ? safePayload.messages : [];
  return {
    preview: String(safePayload.preview || "").trim(),
    pinned: Boolean(safePayload.pinned),
    branch_from: String(safePayload.branch_from || "").trim() || null,
    mission_id: String(safePayload.mission_id || "").trim() || null,
    message_count: messages.length,
    workspace_file_count: Number(safePayload.workspace_file_count) || 0,
    updated_at: String(safePayload.updated_at || "").trim() || null
  };
}
var handler = async (event) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const params = event?.queryStringParameters || {};
  const wsId = clampString(params.ws_id, 64);
  const missionId = clampString(params.mission_id, 64);
  const recordId = clampString(params.id, 64);
  const detail = String(params.detail || "summary").trim().toLowerCase();
  const limit = parseLimit(params.limit);
  if (wsId) {
    const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace read denied." });
  }
  if (missionId) {
    if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
    const mission = await loadMission(u.org_id, missionId);
    if (!mission) return json(404, { error: "Mission not found." });
    if (mission.ws_id) {
      const allowed = await canReadWorkspace(u.org_id, u.user_id, mission.ws_id);
      if (!allowed) return json(403, { error: "Mission workspace read denied." });
    }
  }
  const clauses = ["org_id=$1", "app='NeuralSpacePro'"];
  const args = [u.org_id];
  let idx = 2;
  if (recordId) {
    clauses.push(`id=$${idx++}`);
    args.push(recordId);
  }
  if (wsId) {
    clauses.push(`ws_id=$${idx++}`);
    args.push(wsId);
  }
  if (missionId) {
    clauses.push(`coalesce(payload->>'mission_id','')=$${idx++}`);
    args.push(missionId);
  }
  args.push(limit);
  const rows = await q(
    `select id, ws_id, title, payload, created_at, updated_at
       from app_records
      where ${clauses.join(" and ")}
      order by updated_at desc
      limit $${idx}`,
    args
  );
  const items = rows.rows.map((row) => ({
    id: row.id,
    ws_id: row.ws_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...detail === "full" ? { payload: row.payload || {} } : summarizePayload(row.payload || {})
  }));
  return json(200, { ok: true, items });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=neural-session-list.js.map
