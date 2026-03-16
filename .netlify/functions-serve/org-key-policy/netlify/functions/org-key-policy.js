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

// netlify/functions/org-key-policy.ts
var org_key_policy_exports = {};
__export(org_key_policy_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(org_key_policy_exports);

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

// netlify/functions/_shared/rbac.ts
async function getOrgRole(orgId, userId) {
  const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [orgId, userId]);
  return r.rows[0]?.role || null;
}

// netlify/functions/_shared/api_tokens.ts
var import_crypto = __toESM(require("crypto"), 1);
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function mintApiToken() {
  return `kx_at_${base64url(import_crypto.default.randomBytes(32))}`;
}
function tokenHash(token) {
  return import_crypto.default.createHash("sha256").update(token).digest("hex");
}

// netlify/functions/_shared/org_keys.ts
var TTL_PRESETS_MINUTES = {
  test_2m: 2,
  "1h": 60,
  "5h": 5 * 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
  month: 30 * 24 * 60,
  quarter: 90 * 24 * 60,
  quarterly: 90 * 24 * 60,
  year: 365 * 24 * 60,
  annual: 365 * 24 * 60
};
function mapToken(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    label: row.label || row.prefix || "token",
    prefix: row.prefix,
    locked_email: row.locked_email || null,
    scopes: Array.isArray(row.scopes_json) ? row.scopes_json.map(String) : ["generate"],
    status: row.status || "active",
    created_at: row.created_at,
    expires_at: row.expires_at || null,
    last_used_at: row.last_used_at || null
  };
}
async function ensureOrgKeyTables() {
  await q(
    `create table if not exists org_key_policies (
       org_id uuid primary key references orgs(id) on delete cascade,
       default_token_id uuid references api_tokens(id) on delete set null,
       updated_by uuid references users(id),
       updated_at timestamptz not null default now()
     )`,
    []
  );
  await q(
    `create table if not exists org_user_key_assignments (
       org_id uuid not null references orgs(id) on delete cascade,
       user_id uuid not null references users(id) on delete cascade,
       assigned_token_id uuid references api_tokens(id) on delete set null,
       personal_token_id uuid references api_tokens(id) on delete set null,
       assigned_by uuid references users(id),
       updated_at timestamptz not null default now(),
       primary key (org_id, user_id)
     )`,
    []
  );
  await q("create index if not exists idx_org_user_key_assignments_assigned on org_user_key_assignments(assigned_token_id)", []);
  await q("create index if not exists idx_org_user_key_assignments_personal on org_user_key_assignments(personal_token_id)", []);
}
function resolveTtlMinutes(ttlPreset) {
  const preset = String(ttlPreset || "quarter").trim().toLowerCase();
  return TTL_PRESETS_MINUTES[preset] || TTL_PRESETS_MINUTES.quarter;
}
async function issueOrgScopedToken(options) {
  await ensureOrgKeyTables();
  const token = mintApiToken();
  const prefix = token.slice(0, 14);
  const label = `${String(options.labelPrefix || "token").slice(0, 64)}-${Math.max(1, Number(options.index || 1))}`;
  const scopes = Array.isArray(options.scopes) && options.scopes.length ? options.scopes : ["generate"];
  const ttlMinutes = resolveTtlMinutes(options.ttlPreset);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1e3).toISOString();
  const inserted = await q(
    `insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     returning id, label, prefix, locked_email, scopes_json, status, created_at, expires_at, last_used_at`,
    [
      options.orgId,
      options.issuedByUserId,
      label,
      tokenHash(token),
      prefix,
      expiresAt,
      options.lockedEmail || null,
      JSON.stringify(scopes)
    ]
  );
  return {
    token,
    summary: mapToken(inserted.rows[0])
  };
}
async function setOrgDefaultToken(orgId, tokenId, updatedBy) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_key_policies(org_id, default_token_id, updated_by, updated_at)
     values($1,$2,$3,now())
     on conflict (org_id)
     do update set default_token_id=excluded.default_token_id, updated_by=excluded.updated_by, updated_at=now()`,
    [orgId, tokenId, updatedBy]
  );
}
async function clearOrgDefaultToken(orgId, updatedBy) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_key_policies(org_id, default_token_id, updated_by, updated_at)
     values($1,null,$2,now())
     on conflict (org_id)
     do update set default_token_id=null, updated_by=excluded.updated_by, updated_at=now()`,
    [orgId, updatedBy]
  );
}
async function setAssignedUserToken(orgId, userId, tokenId, assignedBy) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, assigned_token_id, assigned_by, updated_at)
     values($1,$2,$3,$4,now())
     on conflict (org_id, user_id)
     do update set assigned_token_id=excluded.assigned_token_id, assigned_by=excluded.assigned_by, updated_at=now()`,
    [orgId, userId, tokenId, assignedBy]
  );
}
async function clearAssignedUserToken(orgId, userId, assignedBy) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, assigned_token_id, assigned_by, updated_at)
     values($1,$2,null,$3,now())
     on conflict (org_id, user_id)
     do update set assigned_token_id=null, assigned_by=excluded.assigned_by, updated_at=now()`,
    [orgId, userId, assignedBy]
  );
}
async function setPersonalOverrideToken(orgId, userId, tokenId) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, personal_token_id, updated_at)
     values($1,$2,$3,now())
     on conflict (org_id, user_id)
     do update set personal_token_id=excluded.personal_token_id, updated_at=now()`,
    [orgId, userId, tokenId]
  );
}
async function clearPersonalOverrideToken(orgId, userId) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, personal_token_id, updated_at)
     values($1,$2,null,now())
     on conflict (org_id, user_id)
     do update set personal_token_id=null, updated_at=now()`,
    [orgId, userId]
  );
}
async function getOrgKeyPolicySummary(orgId) {
  await ensureOrgKeyTables();
  const org = await q(
    `select o.id, o.allow_personal_key_override,
            p.default_token_id,
            t.id as default_id,
            t.label as default_label,
            t.prefix as default_prefix,
            t.locked_email as default_locked_email,
            t.scopes_json as default_scopes_json,
            t.status as default_status,
            t.created_at as default_created_at,
            t.expires_at as default_expires_at,
            t.last_used_at as default_last_used_at
     from orgs o
     left join org_key_policies p on p.org_id=o.id
     left join api_tokens t on t.id=p.default_token_id
     where o.id=$1
     limit 1`,
    [orgId]
  );
  if (!org.rows.length) return null;
  const assignments = await q(
    `select u.id as user_id,
            u.email,
            a.assigned_token_id,
            a.personal_token_id,
            at.id as assigned_id,
            at.label as assigned_label,
            at.prefix as assigned_prefix,
            at.locked_email as assigned_locked_email,
            at.scopes_json as assigned_scopes_json,
            at.status as assigned_status,
            at.created_at as assigned_created_at,
            at.expires_at as assigned_expires_at,
            at.last_used_at as assigned_last_used_at,
            pt.id as personal_id,
            pt.label as personal_label,
            pt.prefix as personal_prefix,
            pt.locked_email as personal_locked_email,
            pt.scopes_json as personal_scopes_json,
            pt.status as personal_status,
            pt.created_at as personal_created_at,
            pt.expires_at as personal_expires_at,
            pt.last_used_at as personal_last_used_at
     from org_memberships m
     join users u on u.id=m.user_id
     left join org_user_key_assignments a on a.org_id=m.org_id and a.user_id=m.user_id
     left join api_tokens at on at.id=a.assigned_token_id
     left join api_tokens pt on pt.id=a.personal_token_id
     where m.org_id=$1
     order by lower(u.email) asc`,
    [orgId]
  );
  const defaultToken = mapToken({
    id: org.rows[0].default_id,
    label: org.rows[0].default_label,
    prefix: org.rows[0].default_prefix,
    locked_email: org.rows[0].default_locked_email,
    scopes_json: org.rows[0].default_scopes_json,
    status: org.rows[0].default_status,
    created_at: org.rows[0].default_created_at,
    expires_at: org.rows[0].default_expires_at,
    last_used_at: org.rows[0].default_last_used_at
  });
  const allowPersonal = Boolean(org.rows[0].allow_personal_key_override);
  return {
    org_id: org.rows[0].id,
    allow_personal_key_override: allowPersonal,
    default_token: defaultToken,
    assignments: assignments.rows.map((row) => {
      const assignedToken = mapToken({
        id: row.assigned_id,
        label: row.assigned_label,
        prefix: row.assigned_prefix,
        locked_email: row.assigned_locked_email,
        scopes_json: row.assigned_scopes_json,
        status: row.assigned_status,
        created_at: row.assigned_created_at,
        expires_at: row.assigned_expires_at,
        last_used_at: row.assigned_last_used_at
      });
      const personalToken = mapToken({
        id: row.personal_id,
        label: row.personal_label,
        prefix: row.personal_prefix,
        locked_email: row.personal_locked_email,
        scopes_json: row.personal_scopes_json,
        status: row.personal_status,
        created_at: row.personal_created_at,
        expires_at: row.personal_expires_at,
        last_used_at: row.personal_last_used_at
      });
      const effectiveToken = allowPersonal && personalToken ? personalToken : assignedToken || defaultToken || null;
      const effectiveSource = allowPersonal && personalToken ? "personal" : assignedToken ? "assigned" : defaultToken ? "org_default" : "none";
      return {
        user_id: row.user_id,
        email: row.email,
        assigned_token: assignedToken,
        personal_token: personalToken,
        effective_token: effectiveToken,
        effective_source: effectiveSource
      };
    })
  };
}

// netlify/functions/org-key-policy.ts
async function getTargetUser(orgId, emailOrUserId) {
  const normalized = String(emailOrUserId || "").trim().toLowerCase();
  if (!normalized) return null;
  const user = await q(
    `select u.id, u.email
     from org_memberships m
     join users u on u.id=m.user_id
     where m.org_id=$1 and (lower(u.email)=lower($2) or u.id::text=$2)
     limit 1`,
    [orgId, normalized]
  );
  return user.rows[0] || null;
}
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  await ensureOrgKeyTables();
  const role = await getOrgRole(u.org_id, u.user_id);
  if (!role) return json(403, { error: "Forbidden: org membership required." });
  if ((event.httpMethod || "GET").toUpperCase() === "GET") {
    const policy = await getOrgKeyPolicySummary(u.org_id);
    return json(200, { ok: true, policy, role });
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const action = String(body.action || "").trim();
  const isAdmin = role === "owner" || role === "admin";
  if (action === "set_personal_override_policy") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const allow = body.allow_personal_key_override === true;
    await q("update orgs set allow_personal_key_override=$1 where id=$2", [allow, u.org_id]);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.policy.update", { allow_personal_key_override: allow });
    return json(200, { ok: true, policy });
  }
  if (action === "issue_org_default_key") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const issued = await issueOrgScopedToken({
      orgId: u.org_id,
      issuedByUserId: u.user_id,
      labelPrefix: String(body.label_prefix || "org-default").slice(0, 64),
      ttlPreset: String(body.ttl_preset || "quarter"),
      lockedEmail: null,
      scopes: ["generate"]
    });
    await setOrgDefaultToken(u.org_id, issued.summary.id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.default.issue", { token_id: issued.summary.id, label: issued.summary.label });
    return json(200, { ok: true, issued: { ...issued.summary, token: issued.token }, policy });
  }
  if (action === "clear_org_default_key") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    await clearOrgDefaultToken(u.org_id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.default.clear", {});
    return json(200, { ok: true, policy });
  }
  if (action === "issue_user_assignment") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const target = await getTargetUser(u.org_id, String(body.target || body.email || body.user_id || ""));
    if (!target) return json(404, { error: "Target user not found in organization." });
    const issued = await issueOrgScopedToken({
      orgId: u.org_id,
      issuedByUserId: u.user_id,
      labelPrefix: String(body.label_prefix || "member-assigned").slice(0, 64),
      ttlPreset: String(body.ttl_preset || "quarter"),
      lockedEmail: String(target.email || "").trim().toLowerCase(),
      scopes: ["generate"]
    });
    await setAssignedUserToken(u.org_id, target.id, issued.summary.id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.assignment.issue", {
      target_user_id: target.id,
      target_email: target.email,
      token_id: issued.summary.id,
      label: issued.summary.label
    });
    return json(200, {
      ok: true,
      target: { id: target.id, email: target.email },
      issued: { ...issued.summary, token: issued.token },
      policy
    });
  }
  if (action === "clear_user_assignment") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const target = await getTargetUser(u.org_id, String(body.target || body.email || body.user_id || ""));
    if (!target) return json(404, { error: "Target user not found in organization." });
    await clearAssignedUserToken(u.org_id, target.id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.assignment.clear", { target_user_id: target.id, target_email: target.email });
    return json(200, { ok: true, target: { id: target.id, email: target.email }, policy });
  }
  if (action === "issue_personal_override") {
    const org = await q("select allow_personal_key_override from orgs where id=$1 limit 1", [u.org_id]);
    const allow = Boolean(org.rows[0]?.allow_personal_key_override);
    if (!allow) return json(403, { error: "Personal overrides are disabled for this organization." });
    const issued = await issueOrgScopedToken({
      orgId: u.org_id,
      issuedByUserId: u.user_id,
      labelPrefix: String(body.label_prefix || "personal-override").slice(0, 64),
      ttlPreset: String(body.ttl_preset || "quarter"),
      lockedEmail: String(u.email || "").trim().toLowerCase(),
      scopes: ["generate"]
    });
    await setPersonalOverrideToken(u.org_id, u.user_id, issued.summary.id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.personal.issue", { token_id: issued.summary.id, label: issued.summary.label });
    return json(200, { ok: true, issued: { ...issued.summary, token: issued.token }, policy });
  }
  if (action === "clear_personal_override") {
    const target = isAdmin && (body.target || body.email || body.user_id) ? await getTargetUser(u.org_id, String(body.target || body.email || body.user_id || "")) : { id: u.user_id, email: u.email };
    if (!target) return json(404, { error: "Target user not found in organization." });
    if (!isAdmin && target.id !== u.user_id) return json(403, { error: "Forbidden: cannot clear another user's personal override." });
    await clearPersonalOverrideToken(u.org_id, target.id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.personal.clear", { target_user_id: target.id, target_email: target.email });
    return json(200, { ok: true, target: { id: target.id, email: target.email }, policy });
  }
  return json(400, { error: "Unsupported action." });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=org-key-policy.js.map
