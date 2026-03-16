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

// netlify/functions/admin-ai-brain-usage.ts
var admin_ai_brain_usage_exports = {};
__export(admin_ai_brain_usage_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(admin_ai_brain_usage_exports);

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

// netlify/functions/admin-ai-brain-usage.ts
function parseLimit(value, fallback, max) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}
function schemaMissing(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("ai_brain_usage_log") && (text.includes("does not exist") || text.includes("undefined_table"));
}
var handler = async (event) => {
  const user = await requireUser(event);
  if (!user) return forbid();
  if (!user.org_id) return json(400, { error: "User has no org." });
  const role = await getOrgRole(user.org_id, user.user_id);
  if (role !== "owner" && role !== "admin") {
    return json(403, { error: "Forbidden: owner/admin role required." });
  }
  const params = event.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const app = String(params.app || "").trim();
  const actor = String(params.actor || "").trim();
  const route = String(params.route || "").trim().toLowerCase();
  const before = String(params.before || "").trim();
  const usedBackupParam = String(params.used_backup || "").trim().toLowerCase();
  const limit = parseLimit(params.limit, 50, 200);
  const clauses = ["org_id=$1"];
  const values = [user.org_id];
  let idx = 2;
  if (wsId) {
    clauses.push(`ws_id=$${idx++}`);
    values.push(wsId);
  }
  if (app) {
    clauses.push(`app=$${idx++}`);
    values.push(app);
  }
  if (actor) {
    clauses.push(`(actor ilike $${idx} or actor_email ilike $${idx})`);
    values.push(`%${actor}%`);
    idx += 1;
  }
  if (route === "primary" || route === "backup") {
    clauses.push(`brain_route=$${idx++}`);
    values.push(route);
  }
  if (usedBackupParam === "true" || usedBackupParam === "false") {
    clauses.push(`used_backup=$${idx++}`);
    values.push(usedBackupParam === "true");
  }
  if (before) {
    clauses.push(`at < $${idx++}`);
    values.push(before);
  }
  const where = clauses.join(" and ");
  try {
    const summary = await q(
      `select count(*)::int as total_requests,
              coalesce(sum(case when used_backup then 1 else 0 end), 0)::int as backup_requests,
              coalesce(sum(case when success then 1 else 0 end), 0)::int as successful_requests,
              coalesce(sum(case when usage_json->>'prompt_tokens' ~ '^\\d+$' then (usage_json->>'prompt_tokens')::bigint else 0 end), 0)::bigint as prompt_tokens,
              coalesce(sum(case when usage_json->>'completion_tokens' ~ '^\\d+$' then (usage_json->>'completion_tokens')::bigint else 0 end), 0)::bigint as completion_tokens,
              coalesce(sum(case when usage_json->>'total_tokens' ~ '^\\d+$' then (usage_json->>'total_tokens')::bigint else 0 end), 0)::bigint as total_tokens,
              max(at) as latest_at
         from ai_brain_usage_log
        where ${where}`,
      values
    );
    const appBreakdown = await q(
      `select app,
              count(*)::int as requests,
              coalesce(sum(case when used_backup then 1 else 0 end), 0)::int as backup_requests,
              coalesce(sum(case when usage_json->>'total_tokens' ~ '^\\d+$' then (usage_json->>'total_tokens')::bigint else 0 end), 0)::bigint as total_tokens
         from ai_brain_usage_log
        where ${where}
        group by app
        order by requests desc, app asc
        limit 20`,
      values
    );
    const actorBreakdown = await q(
      `select coalesce(nullif(actor_email, ''), actor) as actor,
              count(*)::int as requests,
              coalesce(sum(case when used_backup then 1 else 0 end), 0)::int as backup_requests,
              coalesce(sum(case when usage_json->>'total_tokens' ~ '^\\d+$' then (usage_json->>'total_tokens')::bigint else 0 end), 0)::bigint as total_tokens
         from ai_brain_usage_log
        where ${where}
        group by coalesce(nullif(actor_email, ''), actor)
        order by requests desc, actor asc
        limit 20`,
      values
    );
    const itemValues = [...values, limit];
    const items = await q(
      `select id, at, actor, actor_email, actor_user_id, ws_id, app, auth_type,
              api_token_id, api_token_label, api_token_locked_email,
              used_backup, brain_route, provider, model,
              gateway_request_id, backup_request_id, gateway_status, backup_status,
              usage_json, billing_json, success
         from ai_brain_usage_log
        where ${where}
        order by at desc
        limit $${idx}`,
      itemValues
    );
    return json(200, {
      ok: true,
      filters: {
        ws_id: wsId || null,
        app: app || null,
        actor: actor || null,
        route: route || null,
        used_backup: usedBackupParam === "true" ? true : usedBackupParam === "false" ? false : null,
        before: before || null,
        limit
      },
      summary: summary.rows[0] || null,
      breakdowns: {
        apps: appBreakdown.rows,
        actors: actorBreakdown.rows
      },
      items: items.rows
    });
  } catch (error) {
    if (schemaMissing(error)) {
      return json(500, {
        error: "ai_brain_usage_log is missing in the active Neon database. Apply db/schema.sql to the same database pointed to by NEON_DATABASE_URL."
      });
    }
    return json(500, { error: String(error?.message || "AI usage report failed.") });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=admin-ai-brain-usage.js.map
