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

// netlify/functions/token-issue.ts
var token_issue_exports = {};
__export(token_issue_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(token_issue_exports);

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
function hasValidMasterSequence(provided, expected) {
  const a = String(provided || "");
  const b = String(expected || "");
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return import_crypto.default.timingSafeEqual(aa, bb);
}

// netlify/functions/token-issue.ts
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
function resolveTtlMinutes(body) {
  const preset = String(body.ttl_preset || "").trim().toLowerCase();
  if (preset && TTL_PRESETS_MINUTES[preset]) {
    return { minutes: TTL_PRESETS_MINUTES[preset], mode: `preset:${preset}` };
  }
  if (body.ttl_minutes !== void 0) {
    const ttlMinutes = Math.max(1, Math.min(525600, Number(body.ttl_minutes)));
    return { minutes: ttlMinutes, mode: "minutes" };
  }
  if (body.ttl_days !== void 0) {
    const ttlDays = Math.max(1, Math.min(365, Number(body.ttl_days)));
    return { minutes: ttlDays * 24 * 60, mode: "days" };
  }
  return { minutes: 90 * 24 * 60, mode: "default:quarter" };
}
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
  }
  const count = Math.max(1, Math.min(200, Number(body.count || 1)));
  const ttl = resolveTtlMinutes(body);
  const labelPrefix = String(body.label_prefix || "token").slice(0, 64);
  const requestedLockedEmail = String(body.locked_email || "").trim().toLowerCase();
  const unlockRequested = body.unlock_email_lock === true;
  const scopes = ["generate"];
  const masterProvided = String(body.token_master_sequence || "");
  const masterExpected = opt("TOKEN_MASTER_SEQUENCE", "");
  const hasMaster = hasValidMasterSequence(masterProvided, masterExpected);
  if (requestedLockedEmail && requestedLockedEmail !== u.email.toLowerCase() || unlockRequested) {
    if (!hasMaster) {
      return json(403, { error: "Email lock override requires TOKEN_MASTER_SEQUENCE." });
    }
  }
  const lockedEmail = unlockRequested ? null : requestedLockedEmail || u.email.toLowerCase();
  const issuer = await q("select id from users where email=$1 limit 1", [u.email.toLowerCase()]);
  const issuerId = issuer.rows[0]?.id || null;
  const startsAt = (/* @__PURE__ */ new Date()).toISOString();
  const expiresAt = new Date(Date.now() + ttl.minutes * 60 * 1e3).toISOString();
  const issued = [];
  for (let i = 0; i < count; i++) {
    const token = mintApiToken();
    const prefix = token.slice(0, 14);
    const label = `${labelPrefix}-${i + 1}`;
    const inserted = await q(
      "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning id, created_at, expires_at, locked_email, scopes_json",
      [u.org_id, issuerId, label, tokenHash(token), prefix, expiresAt, lockedEmail, JSON.stringify(scopes)]
    );
    issued.push({
      id: inserted.rows[0].id,
      label,
      prefix,
      starts_at: startsAt,
      created_at: inserted.rows[0].created_at,
      expires_at: inserted.rows[0].expires_at,
      locked_email: inserted.rows[0].locked_email || null,
      scopes: Array.isArray(inserted.rows[0].scopes_json) ? inserted.rows[0].scopes_json : scopes,
      token
    });
  }
  await audit(u.email, u.org_id, null, "token.issue", {
    count,
    ttl_mode: ttl.mode,
    ttl_minutes: ttl.minutes,
    label_prefix: labelPrefix,
    locked_email: lockedEmail,
    scopes,
    master_used: hasMaster
  });
  return json(200, {
    ok: true,
    count: issued.length,
    ttl_mode: ttl.mode,
    ttl_minutes: ttl.minutes,
    issued,
    warning: "Tokens are only shown once. Store them securely now.",
    accepted_ttl_presets: ["test_2m", "1h", "5h", "day", "week", "month", "quarter", "quarterly", "year", "annual"]
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=token-issue.js.map
