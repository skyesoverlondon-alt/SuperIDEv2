"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/auth-founder-gateway.ts
var auth_founder_gateway_exports = {};
__export(auth_founder_gateway_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(auth_founder_gateway_exports);

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
function opt(name, fallback = "") {
  return process.env[name] || fallback;
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
var import_crypto = __toESM(require("crypto"), 1);
var COOKIE = "kx_session";
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function timingSafeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return import_crypto.default.timingSafeEqual(aa, bb);
}
function hasValidFounderGatewayKey(provided) {
  const expected = opt("Founders_GateWay_Key", opt("FOUNDERS_GATEWAY_KEY", ""));
  return timingSafeEqual(String(provided || ""), String(expected || ""));
}
async function resolveFounderGatewayUser() {
  const configuredEmail = String(
    opt("Founders_GateWay_Email", opt("FOUNDERS_GATEWAY_EMAIL", ""))
  ).trim().toLowerCase();
  const readUserByEmail = async (email) => {
    const res = await q(
      `select u.id as user_id, u.email, coalesce(u.org_id, m.org_id) as org_id
         from users u
         left join org_memberships m on m.user_id=u.id
        where lower(u.email)=lower($1)
        order by case when lower(coalesce(m.role, ''))='owner' then 0 else 1 end,
                 coalesce(m.org_id, u.org_id) asc,
                 u.id asc
        limit 1`,
      [email]
    );
    if (!res.rows.length) return null;
    return {
      user_id: res.rows[0].user_id,
      email: res.rows[0].email,
      org_id: res.rows[0].org_id || null
    };
  };
  if (configuredEmail) {
    const configured = await readUserByEmail(configuredEmail);
    if (configured) return configured;
  }
  const founderLocal = await readUserByEmail("founder@skye.local");
  if (founderLocal) return founderLocal;
  const owner = await q(
    `select u.id as user_id, u.email, coalesce(u.org_id, m.org_id) as org_id
       from org_memberships m
       join users u on u.id=m.user_id
      where lower(coalesce(m.role, ''))='owner'
      order by m.org_id asc, u.id asc
      limit 1`,
    []
  );
  if (!owner.rows.length) return null;
  return {
    user_id: owner.rows[0].user_id,
    email: owner.rows[0].email,
    org_id: owner.rows[0].org_id || null
  };
}
async function createSession(user_id) {
  const token = base64url(import_crypto.default.randomBytes(32));
  const expires = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 14);
  await q(
    "insert into sessions(user_id, token, expires_at) values($1,$2,$3)",
    [user_id, token, expires.toISOString()]
  );
  return { token, expires };
}
async function ensureUserRecoveryEmailColumn() {
  await q("alter table if exists users add column if not exists recovery_email text", []);
  await q("create index if not exists idx_users_recovery_email on users(lower(recovery_email))", []);
}
async function ensureUserPinColumns() {
  await q("alter table if exists users add column if not exists pin_hash text", []);
  await q("alter table if exists users add column if not exists pin_updated_at timestamptz", []);
}
function shouldUseSecureCookie(event) {
  const protoHeader = String(
    event?.headers?.["x-forwarded-proto"] || event?.headers?.["X-Forwarded-Proto"] || ""
  ).split(",")[0].trim().toLowerCase();
  if (protoHeader === "https") return true;
  if (protoHeader === "http") return false;
  const host = String(event?.headers?.host || event?.headers?.Host || "").trim().toLowerCase().split(":")[0];
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) {
    return false;
  }
  return true;
}
function setSessionCookie(token, expires, event) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax;${shouldUseSecureCookie(event) ? " Secure;" : ""} Expires=${expires.toUTCString()}`;
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

// netlify/functions/_shared/rbac.ts
async function getOrgRole(orgId, userId) {
  const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [orgId, userId]);
  return r.rows[0]?.role || null;
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

// netlify/functions/_shared/api_tokens.ts
var import_crypto2 = __toESM(require("crypto"), 1);
function base64url2(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function mintApiToken() {
  return `kx_at_${base64url2(import_crypto2.default.randomBytes(32))}`;
}
function tokenHash(token) {
  return import_crypto2.default.createHash("sha256").update(token).digest("hex");
}

// netlify/functions/auth-founder-gateway.ts
var handler = async (event) => {
  try {
    await ensureUserRecoveryEmailColumn();
    await ensureUserPinColumns();
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    const providedKey = String(body?.key || "").trim();
    if (!providedKey) {
      return json(400, { error: "Founder gateway key is required." });
    }
    if (!hasValidFounderGatewayKey(providedKey)) {
      return json(401, { error: "Invalid founder gateway key." });
    }
    const founder = await resolveFounderGatewayUser();
    if (!founder) {
      return json(503, { error: "Founder gateway user is not configured in the current runtime." });
    }
    if (!founder.org_id) {
      return json(503, { error: "Founder gateway user is missing an organization binding." });
    }
    await q(
      `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata)
       values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       on conflict (org_id, user_id) do nothing`,
      [
        founder.org_id,
        founder.user_id,
        founder.email,
        founder.email,
        "gmail_smtp",
        true,
        true,
        JSON.stringify({ source: "auth-founder-gateway" })
      ]
    );
    await q(
      "update api_tokens set status='revoked', revoked_at=now() where org_id=$1 and issued_by=$2 and status='active' and label like 'founder-gateway%'",
      [founder.org_id, founder.user_id]
    );
    const role = await getOrgRole(founder.org_id, founder.user_id);
    const workspace = await ensurePrimaryWorkspace(founder.org_id, founder.user_id, role || "owner");
    const org = await getOrgSeatSummary(founder.org_id);
    const userRow = await q("select recovery_email, pin_hash from users where id=$1 limit 1", [founder.user_id]);
    const recoveryEmail = String(userRow.rows[0]?.recovery_email || "");
    const hasPin = Boolean(String(userRow.rows[0]?.pin_hash || "").trim());
    const token = mintApiToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1e3).toISOString();
    const label = `founder-gateway-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[^0-9]/g, "")}`;
    await q(
      "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [founder.org_id, founder.user_id, label, tokenHash(token), token.slice(0, 14), expiresAt, null, JSON.stringify(["admin"])]
    );
    const session = await createSession(founder.user_id);
    await audit(founder.email, founder.org_id, workspace?.id || null, "auth.founder_gateway", {
      token_label: label,
      workspace_id: workspace?.id || null,
      role: role || "owner"
    });
    return json(
      200,
      {
        ok: true,
        founder_gateway: true,
        kaixu_token: {
          token,
          label,
          locked_email: null,
          scopes: ["admin"],
          expires_at: expiresAt
        },
        user: {
          email: founder.email,
          recovery_email: recoveryEmail,
          org_id: founder.org_id,
          workspace_id: workspace?.id || null,
          role,
          has_pin: hasPin
        },
        workspace,
        org,
        onboarding: {
          key_required: false,
          pin_configured: hasPin,
          message: "Founder gateway restored the owner session and issued an unlocked runtime key for this browser origin."
        }
      },
      { "Set-Cookie": setSessionCookie(session.token, session.expires, event) }
    );
  } catch {
    return json(500, { error: "Founder gateway activation failed." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=auth-founder-gateway.js.map
