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

// netlify/functions/ws-member-set.ts
var ws_member_set_exports = {};
__export(ws_member_set_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(ws_member_set_exports);

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

// netlify/functions/ws-member-set.ts
var VALID_WS_ROLES = /* @__PURE__ */ new Set(["editor", "viewer"]);
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  if (!orgRole || !["owner", "admin"].includes(orgRole)) {
    return json(403, { error: "Forbidden: owner/admin required." });
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }
  const wsId = String(body.ws_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "").trim().toLowerCase();
  if (!wsId || !email) return json(400, { error: "Missing ws_id or email." });
  const ws = await q("select org_id from workspaces where id=$1", [wsId]);
  if (!ws.rows.length) return json(404, { error: "Workspace not found." });
  if (ws.rows[0].org_id !== u.org_id) return forbid();
  const target = await q(
    `select u.id, u.email
     from users u
     join org_memberships m on m.user_id=u.id and m.org_id=$1
     where lower(u.email)=lower($2)
     limit 1`,
    [u.org_id, email]
  );
  if (!target.rows.length) return json(404, { error: "Target user is not in this organization." });
  const targetUserId = target.rows[0].id;
  if (role === "remove") {
    await q("delete from workspace_memberships where ws_id=$1 and user_id=$2", [wsId, targetUserId]);
    await audit(u.email, u.org_id, wsId, "ws.member.remove", { email });
    return json(200, { ok: true, removed: true });
  }
  if (!VALID_WS_ROLES.has(role)) {
    return json(400, { error: "Invalid role. Use editor, viewer, or remove." });
  }
  await q(
    `insert into workspace_memberships(ws_id, user_id, role, created_by)
     values($1,$2,$3,$4)
     on conflict (ws_id, user_id) do update set role=excluded.role`,
    [wsId, targetUserId, role, u.user_id]
  );
  await audit(u.email, u.org_id, wsId, "ws.member.set", { email, role });
  return json(200, { ok: true, email, role });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=ws-member-set.js.map
