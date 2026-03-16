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

// netlify/functions/skychat-thread-list.ts
var skychat_thread_list_exports = {};
__export(skychat_thread_list_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_thread_list_exports);

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
function normSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function channelSlugFromInput(value) {
  const slug = normSlug(value);
  return slug || "group";
}
async function findChannelBySlug(orgId, slug) {
  const row = await q(
    `select id, payload
     from app_records
     where org_id=$1
       and app='SkyeChatChannel'
       and lower(coalesce(payload->>'slug',''))=$2
     order by created_at asc
     limit 1`,
    [orgId, slug.toLowerCase()]
  );
  if (!row.rows.length) return null;
  const payload = row.rows[0]?.payload && typeof row.rows[0].payload === "object" ? row.rows[0].payload : {};
  return {
    id: row.rows[0].id,
    slug: String(payload.slug || "").toLowerCase(),
    name: String(payload.name || payload.slug || "Channel"),
    description: String(payload.description || ""),
    kind: String(payload.kind || "group").toLowerCase(),
    visibility: String(payload.visibility || "private").toLowerCase(),
    posting_policy: String(payload.posting_policy || "members").toLowerCase(),
    owner_user_id: payload.owner_user_id ? String(payload.owner_user_id) : null
  };
}
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
async function resolveAccessibleChannel(orgId, userId, role, slugRaw) {
  const slug = channelSlugFromInput(slugRaw || "community");
  const ch = await findChannelBySlug(orgId, slug);
  if (!ch) return null;
  const admin = isOrgAdmin(role);
  const isPublic = ch.visibility === "public";
  if (isPublic || admin) return ch;
  const membership = await q(
    `select id
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'channel_id'=$2
       and payload->>'user_id'=$3
       and coalesce(payload->>'status','')='active'
     limit 1`,
    [orgId, ch.id, userId]
  );
  if (!membership.rows.length) return null;
  return ch;
}

// netlify/functions/skychat-thread-list.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const params = event?.queryStringParameters || {};
  const rootId = String(params.root_id || "").trim();
  const messageId = String(params.message_id || "").trim();
  if (!rootId && !messageId) return json(400, { error: "root_id or message_id is required." });
  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const role = await getOrgRole(u.org_id, u.user_id);
  const rootRow = await q(
    `select id, payload
     from app_records
     where org_id=$1 and app='SkyeChat' and id=coalesce($2::uuid, $3::uuid)
     limit 1`,
    [u.org_id, rootId || null, messageId || null]
  );
  if (!rootRow.rows.length) return json(404, { error: "Thread root not found." });
  const basePayload = rootRow.rows[0]?.payload && typeof rootRow.rows[0].payload === "object" ? rootRow.rows[0].payload : {};
  const channelSlug = String(basePayload.channel_slug || basePayload.channel || "").toLowerCase();
  const channel = await resolveAccessibleChannel(u.org_id, u.user_id, role, channelSlug);
  if (!channel) return json(403, { error: "Channel access denied." });
  const effectiveRoot = String(basePayload.root_id || rootRow.rows[0].id);
  const rows = await q(
    `select a.id, a.title, a.payload, a.created_at, a.updated_at,
       coalesce((
         select sum(case when coalesce((v.payload->>'vote')::int,0) > 0 then 1 when coalesce((v.payload->>'vote')::int,0) < 0 then -1 else 0 end)
         from app_records v
         where v.org_id=a.org_id and v.app='SkyeChatVote' and coalesce(v.payload->>'target_id','')=a.id::text
       ), 0) as vote_score,
       coalesce((
         select max(coalesce((v.payload->>'vote')::int,0))
         from app_records v
         where v.org_id=a.org_id and v.app='SkyeChatVote'
           and coalesce(v.payload->>'target_id','')=a.id::text
           and coalesce(v.payload->>'voter_id','')=$2
       ), 0) as user_vote
     from app_records a
     where a.org_id=$1
       and a.app='SkyeChat'
       and (
         a.id::text=$3
         or coalesce(a.payload->>'root_id','')=$3
       )
       and lower(coalesce(a.payload->>'channel_slug', a.payload->>'channel',''))=$4
     order by coalesce((a.payload->>'depth')::int, 0) asc, a.created_at asc`,
    [u.org_id, u.user_id, effectiveRoot, channelSlug]
  );
  return json(200, {
    ok: true,
    root_id: effectiveRoot,
    channel: channelSlug,
    records: rows.rows
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-thread-list.js.map
