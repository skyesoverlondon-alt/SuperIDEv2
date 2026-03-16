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

// netlify/functions/skymail-account-set.ts
var skymail_account_set_exports = {};
__export(skymail_account_set_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skymail_account_set_exports);

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

// netlify/functions/skymail-account-set.ts
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var PROVIDERS = /* @__PURE__ */ new Set(["gmail_smtp", "resend", "custom_smtp"]);
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const mailboxEmail = String(body.mailbox_email || "").trim().toLowerCase();
  const displayName = String(body.display_name || "").trim().slice(0, 120);
  const provider = String(body.provider || "gmail_smtp").trim().toLowerCase();
  const outboundEnabled = body.outbound_enabled !== false;
  const inboundEnabled = body.inbound_enabled === true;
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
  if (!mailboxEmail || !EMAIL_RE.test(mailboxEmail)) {
    return json(400, { error: "Valid mailbox_email is required." });
  }
  if (!PROVIDERS.has(provider)) {
    return json(400, { error: "Unsupported provider." });
  }
  const result = await q(
    `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata, updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
     on conflict (org_id, user_id)
     do update set
       mailbox_email=excluded.mailbox_email,
       display_name=excluded.display_name,
       provider=excluded.provider,
       outbound_enabled=excluded.outbound_enabled,
       inbound_enabled=excluded.inbound_enabled,
       metadata=excluded.metadata,
       updated_at=now()
     returning id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata, updated_at`,
    [
      u.org_id,
      u.user_id,
      mailboxEmail,
      displayName || null,
      provider,
      outboundEnabled,
      inboundEnabled,
      JSON.stringify(metadata)
    ]
  );
  const account = result.rows[0];
  await audit(u.email, u.org_id, null, "skymail.account.set", {
    mailbox_email: mailboxEmail,
    provider,
    outbound_enabled: outboundEnabled,
    inbound_enabled: inboundEnabled
  });
  return json(200, {
    ok: true,
    account: {
      id: account.id,
      mailbox_email: account.mailbox_email,
      display_name: account.display_name || "",
      provider: account.provider,
      outbound_enabled: Boolean(account.outbound_enabled),
      inbound_enabled: Boolean(account.inbound_enabled),
      metadata: account.metadata || {},
      updated_at: account.updated_at || null
    }
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skymail-account-set.js.map
