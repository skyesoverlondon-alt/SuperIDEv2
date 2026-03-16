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

// netlify/functions/auth-me.ts
var auth_me_exports = {};
__export(auth_me_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(auth_me_exports);

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
async function ensureUserRecoveryEmailColumn() {
  await q("alter table if exists users add column if not exists recovery_email text", []);
  await q("create index if not exists idx_users_recovery_email on users(lower(recovery_email))", []);
}
async function ensureUserPinColumns() {
  await q("alter table if exists users add column if not exists pin_hash text", []);
  await q("alter table if exists users add column if not exists pin_updated_at timestamptz", []);
}

// netlify/functions/_shared/orgs.ts
var PLAN_SEAT_LIMITS = {
  base: 2,
  scaling: 20,
  executive: 100,
  corporate: 250
};
async function ensureOrgSeatColumns() {
  await q("alter table if exists orgs add column if not exists plan_tier text not null default 'base'", []);
  await q("alter table if exists orgs add column if not exists seat_limit integer", []);
  await q(
    "alter table if exists orgs add column if not exists allow_personal_key_override boolean not null default false",
    []
  );
}
function normalizeOrgPlanTier(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "scaling") return "scaling";
  if (normalized === "executive") return "executive";
  if (normalized === "corporate") return "corporate";
  if (normalized === "enterprise") return "enterprise";
  return "base";
}
function getPlanSeatLimit(planTier) {
  if (planTier === "enterprise") return null;
  return PLAN_SEAT_LIMITS[planTier];
}
async function getOrgSeatSummary(orgId) {
  await ensureOrgSeatColumns();
  const org = await q(
    `select id, name, coalesce(nullif(plan_tier, ''), 'base') as plan_tier, seat_limit, allow_personal_key_override
     from orgs
     where id=$1
     limit 1`,
    [orgId]
  );
  if (!org.rows.length) return null;
  const counts = await q(
    `select
       (select count(*)::int from org_memberships where org_id=$1) as active_members,
       (select count(*)::int from org_invites where org_id=$1 and status='pending' and expires_at > now()) as pending_invites`,
    [orgId]
  );
  const planTier = normalizeOrgPlanTier(org.rows[0].plan_tier);
  const explicitSeatLimit = org.rows[0].seat_limit;
  const seatLimit = explicitSeatLimit == null ? getPlanSeatLimit(planTier) : Number(explicitSeatLimit);
  const activeMembers = Number(counts.rows[0]?.active_members || 0);
  const pendingInvites = Number(counts.rows[0]?.pending_invites || 0);
  const seatsReserved = activeMembers + pendingInvites;
  return {
    org_id: org.rows[0].id,
    org_name: org.rows[0].name,
    plan_tier: planTier,
    seat_limit: seatLimit,
    active_members: activeMembers,
    pending_invites: pendingInvites,
    seats_reserved: seatsReserved,
    seats_available: seatLimit == null ? null : Math.max(seatLimit - seatsReserved, 0),
    allow_personal_key_override: Boolean(org.rows[0].allow_personal_key_override)
  };
}
function workspaceRoleForOrgRole(role) {
  return role === "viewer" ? "viewer" : "editor";
}
async function ensurePrimaryWorkspace(orgId, userId, role, preferredName = "Primary Workspace") {
  const existing = await q(
    `select id, org_id, name, created_at, updated_at
     from workspaces
     where org_id=$1
     order by created_at asc
     limit 1`,
    [orgId]
  );
  const workspace = existing.rows.length ? existing.rows[0] : (await q(
    `insert into workspaces(org_id, name, files_json)
           values($1,$2,$3::jsonb)
           returning id, org_id, name, created_at, updated_at`,
    [orgId, preferredName, "[]"]
  )).rows[0];
  await q(
    `insert into workspace_memberships(ws_id, user_id, role, created_by)
     values($1,$2,$3,$4)
     on conflict (ws_id, user_id) do update set role=excluded.role`,
    [workspace.id, userId, workspaceRoleForOrgRole(role), userId]
  );
  return workspace;
}

// netlify/functions/auth-me.ts
var handler = async (event) => {
  await ensureUserRecoveryEmailColumn();
  await ensureUserPinColumns();
  const u = await requireUser(event);
  if (!u) return json(200, null);
  let role = null;
  let recoveryEmail = "";
  let workspace = null;
  let org = null;
  if (u.org_id) {
    const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [u.org_id, u.user_id]);
    role = r.rows[0]?.role || null;
    workspace = await ensurePrimaryWorkspace(u.org_id, u.user_id, role || "member");
    org = await getOrgSeatSummary(u.org_id);
  }
  const userRow = await q("select recovery_email, pin_hash, pin_updated_at from users where id=$1 limit 1", [u.user_id]);
  recoveryEmail = String(userRow.rows[0]?.recovery_email || "");
  return json(200, {
    id: u.user_id,
    email: u.email,
    recovery_email: recoveryEmail,
    has_pin: Boolean(String(userRow.rows[0]?.pin_hash || "").trim()),
    pin_updated_at: userRow.rows[0]?.pin_updated_at || null,
    org_id: u.org_id,
    role,
    workspace,
    org
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=auth-me.js.map
