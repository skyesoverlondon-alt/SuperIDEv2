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

// netlify/functions/skychat-topic-feed.ts
var skychat_topic_feed_exports = {};
__export(skychat_topic_feed_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_topic_feed_exports);

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

// netlify/functions/_shared/skychat.ts
async function ensureCoreSkychatChannels(orgId, actorUserId) {
  const defaults = [
    {
      slug: "community",
      name: "Community Broadcast",
      description: "Global broadcast channel for all users in the organization.",
      kind: "broadcast",
      visibility: "public",
      posting_policy: "all"
    },
    {
      slug: "admin-board",
      name: "Admin Board",
      description: "Admin announcement board; updates fan out to every member notification inbox.",
      kind: "admin",
      visibility: "public",
      posting_policy: "admin"
    }
  ];
  for (const d of defaults) {
    await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       select $1, null, 'SkyeChatChannel', $2, $3::jsonb, $4
       where not exists (
         select 1
         from app_records
         where org_id=$1 and app='SkyeChatChannel' and lower(coalesce(payload->>'slug',''))=$5
       )`,
      [
        orgId,
        `#${d.slug}`,
        JSON.stringify({
          slug: d.slug,
          name: d.name,
          description: d.description,
          kind: d.kind,
          visibility: d.visibility,
          posting_policy: d.posting_policy,
          owner_user_id: null,
          system_default: true
        }),
        actorUserId,
        d.slug
      ]
    );
  }
}
async function getOrgRole(orgId, userId) {
  const roleRow = await q(
    "select role from org_memberships where org_id=$1 and user_id=$2 limit 1",
    [orgId, userId]
  );
  return roleRow.rows[0]?.role || null;
}
function isOrgAdmin(role) {
  return role === "owner" || role === "admin";
}
async function listAccessibleChannels(orgId, userId, role) {
  const rows = await q(
    `select id, payload
     from app_records
     where org_id=$1 and app='SkyeChatChannel'
     order by coalesce((payload->>'system_default')::boolean, false) desc, created_at asc`,
    [orgId]
  );
  const memberships = await q(
    `select payload
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'user_id'=$2
       and coalesce(payload->>'status','')='active'`,
    [orgId, userId]
  );
  const allowedChannelIds = new Set(
    memberships.rows.map((row) => row?.payload && typeof row.payload === "object" ? String(row.payload.channel_id || "") : "").filter(Boolean)
  );
  const admin = isOrgAdmin(role);
  const out = [];
  for (const row of rows.rows) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const ch = {
      id: row.id,
      slug: String(payload.slug || "").toLowerCase(),
      name: String(payload.name || payload.slug || "Channel"),
      description: String(payload.description || ""),
      kind: String(payload.kind || "group").toLowerCase(),
      visibility: String(payload.visibility || "private").toLowerCase(),
      posting_policy: String(payload.posting_policy || "members").toLowerCase(),
      owner_user_id: payload.owner_user_id ? String(payload.owner_user_id) : null
    };
    if (!ch.slug) continue;
    const isPublic = ch.visibility === "public";
    if (isPublic || admin || allowedChannelIds.has(ch.id)) {
      out.push(ch);
    }
  }
  return out;
}

// netlify/functions/skychat-topic-feed.ts
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
  const topic = String(params.topic || "").trim().toLowerCase();
  const period = String(params.period || "7d").trim().toLowerCase();
  const limit = parseLimit(params.limit);
  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const role = await getOrgRole(u.org_id, u.user_id);
  const channels = await listAccessibleChannels(u.org_id, u.user_id, role);
  const channelSlugs = channels.map((c) => c.slug);
  if (!channelSlugs.length) return json(200, { ok: true, records: [], topics: [] });
  const interval = period === "24h" ? "24 hours" : period === "30d" ? "30 days" : "7 days";
  const rows = await q(
    `select a.id, a.title, a.payload, a.created_at, a.updated_at,
       coalesce((
         select sum(case when coalesce((v.payload->>'vote')::int,0) > 0 then 1 when coalesce((v.payload->>'vote')::int,0) < 0 then -1 else 0 end)
         from app_records v
         where v.org_id=a.org_id and v.app='SkyeChatVote' and coalesce(v.payload->>'target_id','')=a.id::text and coalesce((v.payload->>'active')::boolean,false)=true
       ), 0) as vote_score,
       (
         select count(*)::int
         from app_records r
         where r.org_id=a.org_id and r.app='SkyeChat' and coalesce(r.payload->>'root_id','')=a.id::text and coalesce(r.payload->>'post_type','post')='reply'
       ) as reply_count
     from app_records a
     where a.org_id=$1
       and a.app='SkyeChat'
       and lower(coalesce(a.payload->>'channel_slug', a.payload->>'channel','')) = any($2::text[])
       and coalesce(a.payload->>'post_type','post')='post'
       and ($3::text='' or lower(coalesce(a.payload->>'topic',''))=$3)
       and a.updated_at > now() - ($4::text)::interval
     order by vote_score desc, reply_count desc, a.updated_at desc
     limit $5`,
    [u.org_id, channelSlugs, topic, interval, limit]
  );
  const topicRows = await q(
    `select lower(coalesce(payload->>'topic','')) as topic, count(*)::int as c
     from app_records
     where org_id=$1 and app='SkyeChat'
       and lower(coalesce(payload->>'channel_slug', payload->>'channel','')) = any($2::text[])
       and coalesce(payload->>'post_type','post')='post'
       and coalesce(payload->>'topic','') <> ''
       and updated_at > now() - ($3::text)::interval
     group by lower(coalesce(payload->>'topic',''))
     order by c desc, topic asc
     limit 20`,
    [u.org_id, channelSlugs, interval]
  );
  return json(200, {
    ok: true,
    period,
    topic: topic || null,
    records: rows.rows,
    topics: topicRows.rows
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-topic-feed.js.map
