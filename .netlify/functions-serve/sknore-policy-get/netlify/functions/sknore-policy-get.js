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

// netlify/functions/sknore-policy-get.ts
var sknore_policy_get_exports = {};
__export(sknore_policy_get_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(sknore_policy_get_exports);

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

// netlify/functions/sknore-policy-get.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const params = event?.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const scoped = wsId ? await q(
    `select id, ws_id, payload, updated_at
         from app_records
         where org_id=$1 and app='SKNorePolicy' and ws_id=$2
         order by updated_at desc
         limit 1`,
    [u.org_id, wsId]
  ) : { rows: [] };
  if (scoped.rows.length) {
    const rec2 = scoped.rows[0];
    const payload2 = rec2.payload || {};
    return json(200, {
      ok: true,
      scope: "workspace",
      ws_id: rec2.ws_id,
      patterns: Array.isArray(payload2.patterns) ? payload2.patterns : [],
      updated_at: rec2.updated_at || null
    });
  }
  const orgWide = await q(
    `select id, ws_id, payload, updated_at
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ws_id is null
     order by updated_at desc
     limit 1`,
    [u.org_id]
  );
  if (!orgWide.rows.length) {
    return json(200, {
      ok: true,
      scope: wsId ? "workspace" : "org",
      ws_id: wsId || null,
      patterns: [],
      updated_at: null
    });
  }
  const rec = orgWide.rows[0];
  const payload = rec.payload || {};
  return json(200, {
    ok: true,
    scope: "org",
    ws_id: null,
    patterns: Array.isArray(payload.patterns) ? payload.patterns : [],
    updated_at: rec.updated_at || null
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=sknore-policy-get.js.map
