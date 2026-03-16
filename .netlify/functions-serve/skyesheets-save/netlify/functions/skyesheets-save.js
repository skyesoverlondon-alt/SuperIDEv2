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

// netlify/functions/skyesheets-save.ts
var skyesheets_save_exports = {};
__export(skyesheets_save_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skyesheets_save_exports);

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

// netlify/functions/skyesheets-save.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
  }
  const wsId = String(body.ws_id || "").trim();
  const recordId = String(body.record_id || "").trim();
  const expectedUpdatedAt = String(body.expected_updated_at || "").trim();
  const title = String(body.title || "SkyeSheets Workbook").trim();
  const model = body.model;
  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!model || typeof model !== "object") return json(400, { error: "Missing model payload." });
  const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace write denied." });
  try {
    let saved;
    if (recordId) {
      saved = await q(
        `update app_records
         set title=$1, payload=$2::jsonb, updated_at=now()
         where id=$3 and org_id=$4 and app='SkyeSheets'
           and ($5::timestamptz is null or updated_at = $5::timestamptz)
         returning id, updated_at`,
        [title, JSON.stringify(model), recordId, u.org_id, expectedUpdatedAt || null]
      );
      if (!saved.rows.length) {
        const current = await q(
          `select id, updated_at from app_records where id=$1 and org_id=$2 and app='SkyeSheets' limit 1`,
          [recordId, u.org_id]
        );
        if (!current.rows.length) return json(404, { error: "SkyeSheets record not found." });
        return json(409, {
          error: "SkyeSheets conflict: record changed by another editor.",
          conflict: true,
          current_record_id: current.rows[0].id,
          current_updated_at: current.rows[0].updated_at
        });
      }
    } else {
      const existing = await q(
        `select id, updated_at
         from app_records
         where org_id=$1 and app='SkyeSheets' and ws_id=$2
         order by updated_at desc
         limit 1`,
        [u.org_id, wsId]
      );
      if (existing.rows.length) {
        if (!expectedUpdatedAt || String(existing.rows[0].updated_at) !== expectedUpdatedAt) {
          return json(409, {
            error: "SkyeSheets conflict: sync latest workspace model before saving.",
            conflict: true,
            current_record_id: existing.rows[0].id,
            current_updated_at: existing.rows[0].updated_at
          });
        }
        saved = await q(
          `update app_records
           set title=$1, payload=$2::jsonb, updated_at=now()
           where id=$3 and updated_at=$4::timestamptz
           returning id, updated_at`,
          [title, JSON.stringify(model), existing.rows[0].id, expectedUpdatedAt]
        );
        if (!saved.rows.length) {
          const current = await q(
            `select id, updated_at from app_records where id=$1 and org_id=$2 and app='SkyeSheets' limit 1`,
            [existing.rows[0].id, u.org_id]
          );
          return json(409, {
            error: "SkyeSheets conflict: record changed by another editor.",
            conflict: true,
            current_record_id: current.rows[0]?.id || existing.rows[0].id,
            current_updated_at: current.rows[0]?.updated_at || existing.rows[0].updated_at
          });
        }
      } else {
        saved = await q(
          `insert into app_records(org_id, ws_id, app, title, payload, created_by)
           values($1,$2,'SkyeSheets',$3,$4::jsonb,$5)
           returning id, updated_at`,
          [u.org_id, wsId, title, JSON.stringify(model), u.user_id]
        );
      }
    }
    await audit(u.email, u.org_id, wsId, "skyesheets.save.ok", {
      record_id: saved.rows[0]?.id || null,
      title
    });
    return json(200, { ok: true, record_id: saved.rows[0]?.id || null, updated_at: saved.rows[0]?.updated_at || null });
  } catch (e) {
    const msg = e?.message || "SkyeSheets save failed.";
    await audit(u.email, u.org_id, wsId, "skyesheets.save.failed", { error: msg });
    return json(500, { error: msg });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skyesheets-save.js.map
