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

// netlify/functions/sknore-policy-set.ts
var sknore_policy_set_exports = {};
__export(sknore_policy_set_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(sknore_policy_set_exports);

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

// netlify/functions/_shared/sknore.ts
function normalizeSknorePatterns(patterns) {
  return Array.from(
    new Set(
      (patterns || []).map((p) => String(p || "").trim()).filter(Boolean).map((p) => p.replace(/^\/+/, ""))
    )
  );
}

// netlify/functions/sknore-policy-set.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const scope = String(body.scope || "org").trim().toLowerCase();
  const wsId = String(body.ws_id || "").trim();
  const rawPatterns = Array.isArray(body.patterns) ? body.patterns : [];
  const patterns = normalizeSknorePatterns(rawPatterns.map((p) => String(p || "")));
  if (scope !== "org" && scope !== "workspace") {
    return json(400, { error: "scope must be org or workspace." });
  }
  if (scope === "workspace" && !wsId) {
    return json(400, { error: "ws_id is required for workspace scope." });
  }
  const targetWs = scope === "workspace" ? wsId : null;
  const existing = await q(
    `select id
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ((ws_id is null and $2::uuid is null) or ws_id=$2::uuid)
     order by updated_at desc
     limit 1`,
    [u.org_id, targetWs || null]
  );
  let recordId = "";
  if (existing.rows.length) {
    const saved = await q(
      `update app_records
       set title=$1, payload=$2::jsonb, updated_at=now()
       where id=$3 and org_id=$4
       returning id`,
      [scope === "workspace" ? `SKNore Policy (${wsId})` : "SKNore Policy (org)", JSON.stringify({ patterns }), existing.rows[0].id, u.org_id]
    );
    recordId = String(saved.rows[0]?.id || existing.rows[0].id || "");
  } else {
    const created = await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       values($1,$2,'SKNorePolicy',$3,$4::jsonb,$5)
       returning id`,
      [u.org_id, targetWs, scope === "workspace" ? `SKNore Policy (${wsId})` : "SKNore Policy (org)", JSON.stringify({ patterns }), u.user_id]
    );
    recordId = String(created.rows[0]?.id || "");
  }
  await audit(u.email, u.org_id, targetWs, "sknore.policy.set", {
    scope,
    ws_id: targetWs,
    patterns_count: patterns.length,
    record_id: recordId || null
  });
  return json(200, {
    ok: true,
    scope,
    ws_id: targetWs,
    patterns,
    record_id: recordId || null
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=sknore-policy-set.js.map
