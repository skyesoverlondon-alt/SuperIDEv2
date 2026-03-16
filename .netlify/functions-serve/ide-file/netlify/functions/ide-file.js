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

// netlify/functions/ide-file.ts
var ide_file_exports = {};
__export(ide_file_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(ide_file_exports);

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

// netlify/functions/ide-file.ts
function sanitizePath(value) {
  return String(value || "").trim().replace(/^\/+/, "");
}
function sanitizeFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry;
    const path = sanitizePath(row.path);
    const content = typeof row.content === "string" ? row.content : "";
    if (!path) return null;
    return { path, content };
  }).filter((row) => Boolean(row));
}
var handler = async (event) => {
  const user = await requireUser(event);
  if (!user) return forbid();
  const method = String(event.httpMethod || "GET").toUpperCase();
  const id = sanitizePath(event.queryStringParameters?.id);
  const queryPath = sanitizePath(event.queryStringParameters?.path);
  if (!id) return json(400, { error: "Missing id." });
  const workspace = await q(
    "select id,org_id,files_json,updated_at from workspaces where id=$1",
    [id]
  );
  if (!workspace.rows.length) return json(404, { error: "Not found." });
  if (workspace.rows[0].org_id !== user.org_id) return forbid();
  if (method === "GET") {
    const canRead = await canReadWorkspace(user.org_id, user.user_id, id);
    if (!canRead) return json(403, { error: "Forbidden: no workspace access." });
    if (!queryPath) return json(400, { error: "Missing path." });
    const files = sanitizeFiles(workspace.rows[0].files_json);
    const match = files.find((file) => file.path === queryPath);
    if (!match) return json(404, { error: "File not found." });
    return json(200, {
      file: {
        path: match.path,
        content: match.content
      },
      revision: workspace.rows[0].updated_at || null
    });
  }
  if (method === "PUT") {
    const canWrite = await canWriteWorkspace(user.org_id, user.user_id, id);
    if (!canWrite) return json(403, { error: "Forbidden: read-only workspace access." });
    const body = JSON.parse(event.body || "{}");
    const filePath = sanitizePath(body.path || queryPath);
    const content = typeof body.content === "string" ? body.content : "";
    const expectedRevision = String(body.expected_revision || "").trim();
    const force = Boolean(body.force);
    if (!filePath) return json(400, { error: "Missing path." });
    const currentRevision = workspace.rows[0].updated_at || null;
    if (!force && expectedRevision && currentRevision && expectedRevision !== currentRevision) {
      return json(409, {
        error: "Conflict: workspace changed on server.",
        conflict: {
          expected_revision: expectedRevision,
          current_revision: currentRevision
        }
      });
    }
    const files = sanitizeFiles(workspace.rows[0].files_json);
    let found = false;
    const nextFiles = files.map((file) => {
      if (file.path !== filePath) return file;
      found = true;
      return { path: filePath, content };
    });
    if (!found) nextFiles.push({ path: filePath, content });
    const write = await q(
      "update workspaces set files_json=$1::jsonb, updated_at=now() where id=$2 returning updated_at",
      [JSON.stringify(nextFiles), id]
    );
    await audit(user.email, user.org_id, id, "ws.file.save", { path: filePath, size: content.length });
    return json(200, {
      ok: true,
      file: { path: filePath, content },
      revision: write.rows[0]?.updated_at || null
    });
  }
  return json(405, { error: "Method not allowed." });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=ide-file.js.map
