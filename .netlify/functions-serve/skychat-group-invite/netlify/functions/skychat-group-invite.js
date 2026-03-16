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

// netlify/functions/skychat-group-invite.ts
var skychat_group_invite_exports = {};
__export(skychat_group_invite_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_group_invite_exports);

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
async function addMemberToChannel(orgId, actorUserId, channelId, channelSlug, invitedUserId, role = "member") {
  await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     select $1, null, 'SkyeChatMembership', $2, $3::jsonb, $4
     where not exists (
       select 1
       from app_records
       where org_id=$1 and app='SkyeChatMembership'
         and payload->>'channel_id'=$5 and payload->>'user_id'=$6 and coalesce(payload->>'status','')='active'
     )`,
    [
      orgId,
      `membership:${channelSlug}:${invitedUserId}`,
      JSON.stringify({
        channel_id: channelId,
        channel_slug: channelSlug,
        user_id: invitedUserId,
        role,
        status: "active",
        invited_by: actorUserId
      }),
      actorUserId,
      channelId,
      invitedUserId
    ]
  );
}

// netlify/functions/skychat-group-invite.ts
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }
  const channel = String(body.channel || "").trim();
  const inviteEmail = String(body.email || "").trim().toLowerCase();
  const inviteRole = String(body.role || "member").trim().toLowerCase() === "moderator" ? "moderator" : "member";
  if (!channel) return json(400, { error: "Missing channel." });
  if (!inviteEmail || !EMAIL_RE.test(inviteEmail)) return json(400, { error: "Valid invite email is required." });
  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  const channelInfo = await resolveAccessibleChannel(u.org_id, u.user_id, orgRole, channel);
  if (!channelInfo) return json(404, { error: "Channel not found or inaccessible." });
  if (channelInfo.kind !== "group") return json(400, { error: "Invites are only supported for group channels." });
  const admin = isOrgAdmin(orgRole);
  const isOwner = channelInfo.owner_user_id && channelInfo.owner_user_id === u.user_id;
  if (!admin && !isOwner) return json(403, { error: "Only group owner/admin can invite members." });
  const target = await q(
    `select u.id, u.email
     from users u
     join org_memberships m on m.user_id=u.id and m.org_id=$1
     where lower(u.email)=$2
     limit 1`,
    [u.org_id, inviteEmail]
  );
  if (!target.rows.length) {
    return json(404, { error: "User must already be in this organization before joining private groups." });
  }
  const invitedUserId = String(target.rows[0].id);
  await addMemberToChannel(u.org_id, u.user_id, channelInfo.id, channelInfo.slug, invitedUserId, inviteRole);
  await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,null,'SkyeNotification',$2,$3::jsonb,$4)`,
    [
      u.org_id,
      "Group Invite",
      JSON.stringify({
        kind: "group_invite",
        read: false,
        target_user_id: invitedUserId,
        channel: channelInfo.slug,
        message: `You were added to #${channelInfo.slug}.`,
        invited_by: u.email
      }),
      u.user_id
    ]
  );
  await audit(u.email, u.org_id, null, "skychat.group.invite", {
    channel: channelInfo.slug,
    invited_email: inviteEmail,
    role: inviteRole
  });
  return json(200, {
    ok: true,
    channel: channelInfo.slug,
    invited_email: inviteEmail,
    role: inviteRole
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-group-invite.js.map
