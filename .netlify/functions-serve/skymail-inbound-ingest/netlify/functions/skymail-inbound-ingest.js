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

// netlify/functions/skymail-inbound-ingest.ts
var skymail_inbound_ingest_exports = {};
__export(skymail_inbound_ingest_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skymail_inbound_ingest_exports);

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

// netlify/functions/_shared/skymail.ts
var import_crypto = __toESM(require("crypto"), 1);
function normalizeSubject(subject) {
  return String(subject || "").toLowerCase().replace(/^(re|fwd|fw):\s*/gi, "").replace(/\s+/g, " ").trim();
}
function stableHash(input) {
  return import_crypto.default.createHash("sha256").update(input).digest("hex").slice(0, 24);
}
function computeThreadId(mailbox, counterpart, subject) {
  const a = String(mailbox || "").trim().toLowerCase();
  const b = String(counterpart || "").trim().toLowerCase();
  const pair = [a, b].sort().join("|");
  const subj = normalizeSubject(subject) || "(no-subject)";
  return `thr_${stableHash(`${pair}|${subj}`)}`;
}
function normalizeLabels(labels, defaults = []) {
  const base = Array.isArray(labels) ? labels : defaults;
  const out = /* @__PURE__ */ new Set();
  for (const item of base) {
    const v = String(item || "").trim().toLowerCase();
    if (!v) continue;
    if (v.length > 32) continue;
    out.add(v);
  }
  return [...out];
}

// netlify/functions/skymail-inbound-ingest.ts
function readIngestSecret(event) {
  const header = event?.headers || {};
  return String(header["x-mail-ingest-secret"] || header["X-Mail-Ingest-Secret"] || "").trim();
}
var handler = async (event) => {
  const expected = String(process.env.MAIL_INGEST_SECRET || "").trim();
  if (!expected) return json(503, { error: "MAIL_INGEST_SECRET is not configured." });
  const provided = readIngestSecret(event);
  if (!provided || provided !== expected) return json(401, { error: "Unauthorized." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const from = String(body.from || "").trim().toLowerCase();
  const to = String(body.to || "").trim().toLowerCase();
  const subject = String(body.subject || "").trim();
  const text = String(body.text || body.body_text || "").trim();
  const html = String(body.html || body.body_html || "").trim();
  const providerMessageId = String(body.message_id || body.provider_message_id || "").trim();
  const receivedAt = String(body.received_at || "").trim();
  const explicitThreadId = String(body.thread_id || "").trim();
  const attachmentsInput = Array.isArray(body.attachments) ? body.attachments : [];
  if (!to || !subject || !text && !html) {
    return json(400, { error: "Missing to, subject, or message body." });
  }
  const account = await q(
    `select sa.org_id, sa.user_id, sa.inbound_enabled
     from skymail_accounts sa
     where lower(sa.mailbox_email)=lower($1)
     order by sa.updated_at desc
     limit 1`,
    [to]
  );
  if (!account.rows.length) {
    return json(404, { error: "No mailbox account mapped for recipient." });
  }
  if (!account.rows[0]?.inbound_enabled) {
    return json(403, { error: "Inbound mail is disabled for this mailbox account." });
  }
  const orgId = String(account.rows[0].org_id);
  const userId = String(account.rows[0].user_id);
  if (providerMessageId) {
    const dedupe = await q(
      `select id
       from app_records
       where org_id=$1
         and app='SkyeMailInbound'
         and payload->>'provider_message_id'=$2
       limit 1`,
      [orgId, providerMessageId]
    );
    if (dedupe.rows.length) {
      return json(200, { ok: true, duplicate: true, id: dedupe.rows[0]?.id || null });
    }
  }
  const title = subject.slice(0, 240) || "(no subject)";
  const threadId = explicitThreadId || computeThreadId(to, from, subject);
  const labels = normalizeLabels(body.labels, ["inbox", "unread"]);
  const payload = {
    direction: "inbound",
    mailbox: to,
    from,
    subject,
    text: text || null,
    html: html || null,
    thread_id: threadId,
    labels,
    unread: true,
    starred: false,
    archived: false,
    attachments: attachmentsInput.map((item) => ({
      filename: String(item?.filename || "").trim().slice(0, 200),
      content_type: String(item?.content_type || "application/octet-stream").trim(),
      size_bytes: Number(item?.size_bytes || 0)
    })).filter((item) => item.filename),
    provider: String(body.provider || "smtp").trim().toLowerCase() || "smtp",
    provider_message_id: providerMessageId || null,
    received_at: receivedAt || (/* @__PURE__ */ new Date()).toISOString()
  };
  const inserted = await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,$2,$3,$4,$5::jsonb,$6)
     returning id, created_at`,
    [orgId, null, "SkyeMailInbound", title, JSON.stringify(payload), userId]
  );
  return json(200, {
    ok: true,
    id: inserted.rows[0]?.id || null,
    mailbox: to,
    received_at: payload.received_at
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skymail-inbound-ingest.js.map
