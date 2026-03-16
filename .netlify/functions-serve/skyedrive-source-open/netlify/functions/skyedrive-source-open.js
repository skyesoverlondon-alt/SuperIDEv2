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

// netlify/functions/skyedrive-source-open.ts
var skyedrive_source_open_exports = {};
__export(skyedrive_source_open_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skyedrive_source_open_exports);

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

// netlify/functions/skyedrive-source-open.ts
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
  const recordId = String(body.record_id || "").trim();
  if (!wsId || !recordId) {
    return json(400, { error: "Missing ws_id or record_id." });
  }
  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });
  const rowResult = await q(
    `select id, title, payload, updated_at
       from app_records
      where id=$1
        and org_id=$2
        and ws_id=$3
        and app='SkyeDrive'
      limit 1`,
    [recordId, u.org_id, wsId]
  );
  const row = rowResult.rows[0];
  if (!row) return json(404, { error: "SkyeDrive source not found." });
  if (String(row?.payload?.kind || "") !== "workspace-source") {
    return json(400, { error: "Selected SkyeDrive record is not a workspace source." });
  }
  const files = Array.isArray(row?.payload?.files) ? row.payload.files.map((file) => ({
    path: String(file?.path || "").replace(/^\/+/, ""),
    content: typeof file?.content === "string" ? file.content : ""
  })).filter((file) => file.path) : [];
  if (!files.length) {
    return json(400, { error: "Selected SkyeDrive source does not contain files." });
  }
  await q(
    `insert into integrations(user_id, skyedrive_ws_id, skyedrive_record_id, skyedrive_title)
     values($1,$2,$3,$4)
     on conflict(user_id) do update
       set skyedrive_ws_id=excluded.skyedrive_ws_id,
           skyedrive_record_id=excluded.skyedrive_record_id,
           skyedrive_title=excluded.skyedrive_title,
           updated_at=now()`,
    [u.user_id, wsId, row.id, row.title]
  );
  await audit(u.email, u.org_id, wsId, "skyedrive.source.open", {
    record_id: row.id,
    title: row.title,
    files: files.length
  });
  return json(200, {
    ok: true,
    record_id: row.id,
    title: row.title,
    updated_at: row.updated_at,
    files
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skyedrive-source-open.js.map
