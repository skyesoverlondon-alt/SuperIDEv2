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

// netlify/functions/auth-password-reset-confirm.ts
var auth_password_reset_confirm_exports = {};
__export(auth_password_reset_confirm_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(auth_password_reset_confirm_exports);
var import_crypto2 = __toESM(require("crypto"), 1);

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
var import_crypto = __toESM(require("crypto"), 1);
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function pbkdf2Hash(password, salt) {
  return new Promise((resolve, reject) => {
    import_crypto.default.pbkdf2(
      password,
      Buffer.from(salt, "base64"),
      15e4,
      32,
      "sha256",
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(base64url(derivedKey));
      }
    );
  });
}
async function hashPassword(password) {
  const salt = import_crypto.default.randomBytes(16).toString("base64");
  const hash = await pbkdf2Hash(password, salt);
  return `pbkdf2$sha256$150000$${salt}$${hash}`;
}
async function ensureUserRecoveryEmailColumn() {
  await q("alter table if exists users add column if not exists recovery_email text", []);
  await q("create index if not exists idx_users_recovery_email on users(lower(recovery_email))", []);
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

// netlify/functions/auth-password-reset-confirm.ts
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function hashToken(token) {
  return import_crypto2.default.createHash("sha256").update(token).digest("hex");
}
async function ensurePasswordResetTable() {
  await q(
    `create table if not exists password_reset_tokens (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null references users(id) on delete cascade,
       token_hash text not null unique,
       expires_at timestamptz not null,
       used_at timestamptz,
       requested_ip text,
       user_agent text,
       created_at timestamptz not null default now()
     )`,
    []
  );
  await q("create index if not exists idx_password_reset_tokens_user on password_reset_tokens(user_id, created_at desc)", []);
  await q("create index if not exists idx_password_reset_tokens_expiry on password_reset_tokens(expires_at, used_at)", []);
}
var handler = async (event) => {
  try {
    await ensurePasswordResetTable();
    await ensureUserRecoveryEmailColumn();
    const body = JSON.parse(event.body || "{}");
    const normalizedEmail = String(body?.email || "").trim().toLowerCase();
    const token = String(body?.token || "").trim();
    const newPassword = String(body?.newPassword || "");
    if (!EMAIL_RE.test(normalizedEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }
    if (!token || token.length < 16) {
      return json(400, { error: "Reset token is required." });
    }
    if (newPassword.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const tokenHash = hashToken(token);
    const lookup = await q(
      `select prt.id as reset_id, prt.user_id, u.email, u.recovery_email, u.org_id
       from password_reset_tokens prt
       join users u on u.id = prt.user_id
       where prt.token_hash=$1
         and prt.used_at is null
         and prt.expires_at > $2
         and lower(coalesce(u.recovery_email, ''))=lower($3)
       limit 1`,
      [tokenHash, nowIso, normalizedEmail]
    );
    if (!lookup.rows.length) {
      return json(400, { error: "Reset token is invalid or expired." });
    }
    const row = lookup.rows[0];
    const pwHash = await hashPassword(newPassword);
    await q("update users set password_hash=$1 where id=$2", [pwHash, row.user_id]);
    await q("update password_reset_tokens set used_at=now() where user_id=$1 and used_at is null", [row.user_id]);
    await q("delete from sessions where user_id=$1", [row.user_id]);
    await audit(normalizedEmail, row.org_id || null, null, "auth.password_reset.confirm", {
      reset_token_id: row.reset_id,
      sessions_revoked: true
    });
    return json(200, {
      ok: true,
      message: "Password reset complete. Sign in with your new password."
    });
  } catch {
    return json(500, { error: "Password reset failed." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=auth-password-reset-confirm.js.map
