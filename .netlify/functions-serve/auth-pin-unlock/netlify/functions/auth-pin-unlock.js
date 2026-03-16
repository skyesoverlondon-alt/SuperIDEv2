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

// netlify/functions/auth-pin-unlock.ts
var auth_pin_unlock_exports = {};
__export(auth_pin_unlock_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(auth_pin_unlock_exports);

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
var COOKIE = "kx_session";
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
async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length < 6) return false;
  const salt = parts[4];
  const want = parts[5];
  const got = await pbkdf2Hash(password, salt);
  return timingSafeEqual(got, want);
}
function timingSafeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return import_crypto.default.timingSafeEqual(aa, bb);
}
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
async function ensureUserPinColumns() {
  await q("alter table if exists users add column if not exists pin_hash text", []);
  await q("alter table if exists users add column if not exists pin_updated_at timestamptz", []);
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

// netlify/functions/auth-pin-unlock.ts
var PIN_RE = /^[A-Za-z0-9]{4,12}$/;
var TTL_PRESETS_MINUTES = {
  "1h": 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
  month: 30 * 24 * 60,
  quarter: 90 * 24 * 60
};
function resolveTtlMinutes(raw) {
  const preset = String(raw || "day").trim().toLowerCase();
  return TTL_PRESETS_MINUTES[preset] || TTL_PRESETS_MINUTES.day;
}
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  await ensureUserPinColumns();
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const pin = String(body.pin || "").trim();
  const labelPrefix = String(body.label_prefix || "pin-unlock").trim().slice(0, 64) || "pin-unlock";
  const ttlMinutes = resolveTtlMinutes(body.ttl_preset);
  if (!PIN_RE.test(pin)) return json(400, { error: "PIN must be 4-12 letters and numbers only." });
  const userRow = await q("select pin_hash, email from users where id=$1 limit 1", [u.user_id]);
  const storedHash = String(userRow.rows[0]?.pin_hash || "").trim();
  const email = String(userRow.rows[0]?.email || u.email || "").trim().toLowerCase();
  if (!storedHash) return json(400, { error: "No session PIN is configured for this account." });
  const ok = await verifyPassword(pin, storedHash);
  if (!ok) {
    await audit(u.email, u.org_id, null, "auth.pin.unlock.failed", { reason: "invalid_pin" });
    return json(401, { error: "Invalid PIN." });
  }
  await q(
    "update api_tokens set status='revoked', revoked_at=now() where org_id=$1 and issued_by=$2 and status='active' and label like $3",
    [u.org_id, u.user_id, `${labelPrefix}%`]
  );
  const token = mintApiToken();
  const prefix = token.slice(0, 14);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1e3).toISOString();
  const label = `${labelPrefix}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[^0-9]/g, "")}`;
  const inserted = await q(
    "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning id, created_at, expires_at, locked_email, scopes_json",
    [u.org_id, u.user_id, label, tokenHash(token), prefix, expiresAt, email || null, JSON.stringify(["generate"])]
  );
  await audit(u.email, u.org_id, null, "auth.pin.unlock", {
    label,
    ttl_minutes: ttlMinutes,
    locked_email: email || null
  });
  return json(200, {
    ok: true,
    unlocked: true,
    token,
    locked_email: inserted.rows[0]?.locked_email || email || null,
    label,
    prefix,
    created_at: inserted.rows[0]?.created_at || null,
    expires_at: inserted.rows[0]?.expires_at || expiresAt,
    scopes: Array.isArray(inserted.rows[0]?.scopes_json) ? inserted.rows[0].scopes_json : ["generate"]
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=auth-pin-unlock.js.map
