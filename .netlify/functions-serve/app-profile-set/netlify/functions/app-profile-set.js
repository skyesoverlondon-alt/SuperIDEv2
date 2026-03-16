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

// netlify/functions/app-profile-set.ts
var app_profile_set_exports = {};
__export(app_profile_set_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(app_profile_set_exports);

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

// netlify/functions/app-profile-set.ts
var ALLOWED_APPS = /* @__PURE__ */ new Set(["SkyeMail", "SkyeChat", "SKYEMAIL-GEN", "Skye-ID"]);
function safeTitle(value, fallback) {
  const next = String(value || "").trim();
  return next.length ? next.slice(0, 120) : fallback;
}
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
  const app = String(body.app || "").trim();
  const payload = body?.profile && typeof body.profile === "object" ? body.profile : {};
  if (!ALLOWED_APPS.has(app)) {
    return json(400, { error: "Unsupported app profile." });
  }
  const title = safeTitle(body?.title, `${app} Profile`);
  const appKey = `${app}Profile`;
  try {
    const existing = await q(
      `select id
       from app_records
       where org_id=$1 and app=$2 and created_by=$3
       order by updated_at desc
       limit 1`,
      [u.org_id, appKey, u.user_id]
    );
    let id = "";
    if (existing.rows.length) {
      id = String(existing.rows[0].id);
      await q(
        `update app_records
         set title=$1, payload=$2::jsonb, updated_at=now()
         where id=$3 and org_id=$4`,
        [title, JSON.stringify(payload), id, u.org_id]
      );
    } else {
      const created = await q(
        `insert into app_records(org_id, app, title, payload, created_by)
         values($1,$2,$3,$4::jsonb,$5)
         returning id`,
        [u.org_id, appKey, title, JSON.stringify(payload), u.user_id]
      );
      id = String(created.rows[0]?.id || "");
    }
    await audit(u.email, u.org_id, null, "app.profile.set", {
      app,
      profile_record_id: id || null
    });
    return json(200, { ok: true, id: id || null });
  } catch (error) {
    return json(500, { error: error?.message || "Profile save failed." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=app-profile-set.js.map
