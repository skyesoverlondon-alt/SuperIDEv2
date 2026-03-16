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

// netlify/functions/skychat-group-create.ts
var skychat_group_create_exports = {};
__export(skychat_group_create_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_group_create_exports);

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
async function createSkychatGroup(orgId, userId, name, description) {
  const baseSlug = channelSlugFromInput(name);
  let slug = baseSlug;
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
    const found = await findChannelBySlug(orgId, candidate);
    if (!found) {
      slug = candidate;
      break;
    }
  }
  const ch = await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,null,'SkyeChatChannel',$2,$3::jsonb,$4)
     returning id, created_at`,
    [
      orgId,
      `#${slug}`,
      JSON.stringify({
        slug,
        name: String(name || slug).trim() || slug,
        description: String(description || "").trim(),
        kind: "group",
        visibility: "private",
        posting_policy: "members",
        owner_user_id: userId
      }),
      userId
    ]
  );
  await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,null,'SkyeChatMembership',$2,$3::jsonb,$4)`,
    [
      orgId,
      `membership:${slug}`,
      JSON.stringify({
        channel_id: ch.rows[0].id,
        channel_slug: slug,
        user_id: userId,
        role: "owner",
        status: "active"
      }),
      userId
    ]
  );
  return { id: ch.rows[0].id, slug, created_at: ch.rows[0].created_at };
}

// netlify/functions/skychat-group-create.ts
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
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  if (!name || name.length < 3) {
    return json(400, { error: "Group name must be at least 3 characters." });
  }
  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const created = await createSkychatGroup(u.org_id, u.user_id, name, description);
  await audit(u.email, u.org_id, null, "skychat.group.create", {
    group_id: created.id,
    group_slug: created.slug
  });
  return json(200, {
    ok: true,
    group: {
      id: created.id,
      slug: created.slug,
      name,
      description,
      created_at: created.created_at
    }
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-group-create.js.map
