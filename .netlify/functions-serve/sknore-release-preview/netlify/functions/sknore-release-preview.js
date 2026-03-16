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

// netlify/functions/sknore-release-preview.ts
var sknore_release_preview_exports = {};
__export(sknore_release_preview_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(sknore_release_preview_exports);

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

// netlify/functions/_shared/sknore.ts
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegex(glob) {
  const normalized = glob.trim().replace(/^\/+/, "");
  const escaped = escapeRegex(normalized).replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`, "i");
}
function normalizeSknorePatterns(patterns) {
  return Array.from(
    new Set(
      (patterns || []).map((p) => String(p || "").trim()).filter(Boolean).map((p) => p.replace(/^\/+/, ""))
    )
  );
}
function isSknoreProtected(path, patterns) {
  const target = String(path || "").replace(/^\/+/, "");
  const normalized = normalizeSknorePatterns(patterns);
  return normalized.some((pattern) => globToRegex(pattern).test(target));
}
function filterSknoreFiles(files, patterns) {
  return (files || []).filter((f) => !isSknoreProtected(f.path, patterns));
}
function normalizeWorkspaceTextFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    path: String(file?.path || "").replace(/^\/+/, ""),
    content: typeof file?.content === "string" ? file.content : ""
  })).filter((file) => file.path);
}
async function buildSknoreReleasePlan(orgId, wsId, rawFiles) {
  const workspace = await q(
    `select org_id, name, files_json
       from workspaces
      where id=$1
      limit 1`,
    [wsId]
  );
  if (!workspace.rows.length) {
    throw new Error("Workspace not found.");
  }
  if (workspace.rows[0].org_id !== orgId) {
    throw new Error("Forbidden.");
  }
  const files = normalizeWorkspaceTextFiles(
    Array.isArray(rawFiles) ? rawFiles : workspace.rows[0].files_json || []
  );
  const patterns = await loadSknorePolicy(orgId, wsId);
  const blockedPaths = files.filter((file) => isSknoreProtected(file.path, patterns)).map((file) => file.path);
  const releaseFiles = filterSknoreFiles(files, patterns);
  return {
    workspaceName: workspace.rows[0].name || null,
    files,
    releaseFiles,
    blockedPaths,
    patterns
  };
}
async function loadSknorePolicy(orgId, wsId) {
  const scoped = wsId ? await q(
    `select payload
         from app_records
         where org_id=$1 and app='SKNorePolicy' and ws_id=$2
         order by updated_at desc
         limit 1`,
    [orgId, wsId]
  ) : { rows: [] };
  if (scoped.rows.length) {
    const payload2 = scoped.rows[0]?.payload || {};
    return normalizeSknorePatterns(Array.isArray(payload2.patterns) ? payload2.patterns : []);
  }
  const orgWide = await q(
    `select payload
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ws_id is null
     order by updated_at desc
     limit 1`,
    [orgId]
  );
  if (!orgWide.rows.length) return [];
  const payload = orgWide.rows[0]?.payload || {};
  return normalizeSknorePatterns(Array.isArray(payload.patterns) ? payload.patterns : []);
}

// netlify/functions/sknore-release-preview.ts
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
  const wsId = String(body.ws_id || "").trim();
  const rawFiles = Array.isArray(body.files) ? body.files : void 0;
  if (!wsId) return json(400, { error: "Missing ws_id." });
  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });
  const releasePlan = await buildSknoreReleasePlan(u.org_id, wsId, rawFiles);
  const scoped = await q(
    `select updated_at
       from app_records
      where org_id=$1 and app='SKNorePolicy' and ws_id=$2
      order by updated_at desc
      limit 1`,
    [u.org_id, wsId]
  );
  const orgWide = !scoped.rows.length ? await q(
    `select updated_at
           from app_records
          where org_id=$1 and app='SKNorePolicy' and ws_id is null
          order by updated_at desc
          limit 1`,
    [u.org_id]
  ) : { rows: [] };
  const scope = scoped.rows.length ? "workspace" : orgWide.rows.length ? "org" : "workspace";
  const updatedAt = scoped.rows[0]?.updated_at || orgWide.rows[0]?.updated_at || null;
  return json(200, {
    ok: true,
    ws_id: wsId,
    workspace_name: releasePlan.workspaceName,
    scope,
    updated_at: updatedAt,
    source: Array.isArray(rawFiles) ? "client-files" : "workspace",
    sknore: {
      included_count: releasePlan.releaseFiles.length,
      blocked_count: releasePlan.blockedPaths.length,
      total_count: releasePlan.files.length,
      blocked_paths: releasePlan.blockedPaths,
      patterns_count: releasePlan.patterns.length
    }
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=sknore-release-preview.js.map
