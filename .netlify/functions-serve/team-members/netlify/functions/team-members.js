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

// netlify/functions/team-members.ts
var team_members_exports = {};
__export(team_members_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(team_members_exports);

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

// netlify/functions/team-members.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  const rows = await q(
    `select m.user_id, u.email, m.role, m.created_at
     from org_memberships m
     join users u on u.id = m.user_id
     where m.org_id=$1
     order by m.created_at asc`,
    [u.org_id]
  );
  const seatSummary = await getOrgSeatSummary(u.org_id);
  const defaultWorkspace = await q(
    `select id, name, created_at, updated_at
     from workspaces
     where org_id=$1
     order by created_at asc
     limit 1`,
    [u.org_id]
  );
  return json(200, {
    ok: true,
    members: rows.rows,
    org: seatSummary,
    workspace: defaultWorkspace.rows[0] || null
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=team-members.js.map
