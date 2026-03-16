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

// netlify/functions/skychat-notification-list.ts
var skychat_notification_list_exports = {};
__export(skychat_notification_list_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_notification_list_exports);

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

// netlify/functions/skychat-notification-list.ts
function parseLimit(raw) {
  const n = Number(raw || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const params = event?.queryStringParameters || {};
  const limit = parseLimit(params.limit);
  const kind = String(params.kind || "").trim().toLowerCase();
  const unreadOnly = String(params.unread_only || "").trim() === "1";
  const before = String(params.before || "").trim();
  const rows = await q(
    `select id, payload, created_at, updated_at
     from app_records
     where org_id=$1
       and app='SkyeNotification'
       and coalesce(payload->>'target_user_id','')=$2
       and ($3::text='' or lower(coalesce(payload->>'kind',''))=$3)
       and ($4::boolean=false or coalesce((payload->>'read')::boolean, false)=false)
       and ($5::timestamptz is null or created_at < $5::timestamptz)
     order by
       case when lower(coalesce(payload->>'priority',''))='critical' then 3 when lower(coalesce(payload->>'priority',''))='high' then 2 else 1 end desc,
       created_at desc
     limit $6`,
    [u.org_id, u.user_id, kind, unreadOnly, before || null, limit]
  );
  const items = rows.rows.map((row) => {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      id: row.id,
      kind: String(payload.kind || "notification"),
      priority: String(payload.priority || "normal"),
      channel: String(payload.channel || ""),
      message: String(payload.message || ""),
      read: Boolean(payload.read),
      source_record_id: String(payload.source_record_id || ""),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
  const unreadCount = items.filter((x) => !x.read).length;
  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.created_at || null : null;
  return json(200, {
    ok: true,
    notifications: items,
    unread_count: unreadCount,
    page: { limit, before: before || null, next_before: nextBefore, has_more: rows.rows.length === limit }
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-notification-list.js.map
