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

// netlify/functions/skymail-message-update.ts
var skymail_message_update_exports = {};
__export(skymail_message_update_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skymail_message_update_exports);

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

// netlify/functions/_shared/skymail.ts
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

// netlify/functions/skymail-message-update.ts
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
  const id = String(body.id || "").trim();
  if (!id) return json(400, { error: "Missing message id." });
  const row = await q(
    `select id, payload
     from app_records
     where id=$1 and org_id=$2 and app in ('SkyeMail', 'SkyeMailInbound')
     limit 1`,
    [id, u.org_id]
  );
  if (!row.rows.length) return json(404, { error: "Message not found." });
  const payload = row.rows[0]?.payload && typeof row.rows[0].payload === "object" ? row.rows[0].payload : {};
  const nextUnread = typeof body.unread === "boolean" ? body.unread : typeof body.read === "boolean" ? !body.read : void 0;
  const nextStarred = typeof body.starred === "boolean" ? body.starred : void 0;
  const nextArchived = typeof body.archived === "boolean" ? body.archived : void 0;
  let labels = normalizeLabels(payload?.labels, []);
  if (Array.isArray(body.labels)) labels = normalizeLabels(body.labels, labels);
  if (typeof body.add_label === "string") labels = normalizeLabels([...labels, body.add_label], labels);
  if (typeof body.remove_label === "string") labels = labels.filter((x) => x !== String(body.remove_label).trim().toLowerCase());
  const unread = typeof nextUnread === "boolean" ? nextUnread : Boolean(payload?.unread);
  const starred = typeof nextStarred === "boolean" ? nextStarred : Boolean(payload?.starred);
  const archived = typeof nextArchived === "boolean" ? nextArchived : Boolean(payload?.archived);
  const dedup = new Set(labels);
  if (unread) dedup.add("unread");
  else dedup.delete("unread");
  if (starred) dedup.add("starred");
  else dedup.delete("starred");
  if (archived) dedup.add("archive");
  else dedup.delete("archive");
  labels = [...dedup];
  const nextPayload = {
    ...payload,
    labels,
    unread,
    starred,
    archived
  };
  await q(
    `update app_records
     set payload=$1::jsonb, updated_at=now()
     where id=$2 and org_id=$3`,
    [JSON.stringify(nextPayload), id, u.org_id]
  );
  await audit(u.email, u.org_id, null, "skymail.message.update", {
    message_id: id,
    unread,
    starred,
    archived,
    labels
  });
  return json(200, { ok: true, id, payload: nextPayload });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skymail-message-update.js.map
