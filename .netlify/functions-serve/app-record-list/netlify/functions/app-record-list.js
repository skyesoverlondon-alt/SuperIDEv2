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

// netlify/functions/app-record-list.ts
var app_record_list_exports = {};
__export(app_record_list_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(app_record_list_exports);

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

// netlify/functions/app-record-list.ts
function parseLimit(raw) {
  const n = Number(raw || 20);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const params = event?.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const app = String(params.app || "").trim();
  const limit = parseLimit(params.limit);
  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!ALLOWED_APP_RECORD_APPS.has(app)) return json(400, { error: "Unsupported app." });
  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });
  const rows = await q(
    `select id, app, ws_id, title, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and ws_id=$2
       and app=$3
     order by updated_at desc
     limit $4`,
    [u.org_id, wsId, app, limit]
  );
  return json(200, {
    ok: true,
    records: rows.rows
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=app-record-list.js.map
