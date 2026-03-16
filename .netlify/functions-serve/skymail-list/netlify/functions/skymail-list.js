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

// netlify/functions/skymail-list.ts
var skymail_list_exports = {};
__export(skymail_list_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skymail_list_exports);

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

// netlify/functions/skymail-list.ts
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
  const before = String(params.before || "").trim();
  const mailbox = String(params.mailbox || "").trim().toLowerCase();
  const search = String(params.q || "").trim().toLowerCase();
  const label = String(params.label || "").trim().toLowerCase();
  const threadId = String(params.thread_id || "").trim();
  const unreadOnly = String(params.unread_only || "").trim() === "1";
  const searchLike = search ? `%${search}%` : "";
  const rows = await q(
    `select id, app, title, payload, created_at, updated_at,
       (
         case when $4::text = '' then 0 else
           (case when lower(coalesce(payload->>'subject','')) = $4 then 40 else 0 end) +
           (case when lower(title) like $5 then 18 else 0 end) +
           (case when lower(coalesce(payload->>'from','')) like $5 then 14 else 0 end) +
           (case when lower(coalesce(payload->>'to','')) like $5 then 14 else 0 end) +
           (case when lower(coalesce(payload->>'text','')) like $5 then 8 else 0 end)
         end
       ) as score
     from app_records
     where org_id=$1
       and app in ('SkyeMail', 'SkyeMailInbound')
       and ($2::timestamptz is null or updated_at < $2::timestamptz)
       and (
         $3::text = ''
         or lower(coalesce(payload->>'to','')) = $3
         or lower(coalesce(payload->>'mailbox','')) = $3
       )
       and (
         $4::text = ''
         or lower(title) like $5
         or lower(coalesce(payload->>'from','')) like $5
         or lower(coalesce(payload->>'mailbox','')) like $5
         or lower(coalesce(payload->>'to','')) like $5
         or lower(coalesce(payload->>'subject','')) like $5
         or lower(coalesce(payload->>'text','')) like $5
       )
       and ($6::text = '' or exists (
         select 1
         from jsonb_array_elements_text(coalesce(payload->'labels','[]'::jsonb)) as lbl
         where lower(lbl) = $6
       ))
       and ($7::text = '' or coalesce(payload->>'thread_id','') = $7)
       and ($8::boolean = false or coalesce((payload->>'unread')::boolean, false) = true)
     order by score desc, updated_at desc
     limit $9`,
    [u.org_id, before || null, mailbox, search, searchLike, label, threadId, unreadOnly, limit]
  );
  const nextBefore = rows.rows.length ? rows.rows[rows.rows.length - 1]?.updated_at || null : null;
  const hasMore = rows.rows.length === limit;
  return json(200, { ok: true, records: rows.rows, page: { limit, before: before || null, next_before: nextBefore, has_more: hasMore } });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skymail-list.js.map
