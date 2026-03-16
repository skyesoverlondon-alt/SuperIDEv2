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

// netlify/functions/vault-profile.ts
var vault_profile_exports = {};
__export(vault_profile_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(vault_profile_exports);

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

// netlify/functions/vault-profile.ts
var APP_KEY = "SkyeVaultProfile";
function tierDrive(planTier = "core") {
  const tier = String(planTier || "core").trim().toLowerCase();
  if (tier === "pro") return "1TB";
  if (tier === "flow") return "512GB";
  return "256GB";
}
async function readProfile(orgId, userId) {
  const row = await q(
    `select id, payload, updated_at
       from app_records
      where org_id=$1 and app=$2 and created_by=$3
      order by updated_at desc
      limit 1`,
    [orgId, APP_KEY, userId]
  );
  return row.rows[0] || null;
}
var handler = async (event) => {
  const user = await requireUser(event);
  if (!user) return forbid();
  if (!user.org_id) return json(400, { error: "User has no org." });
  const method = String(event.httpMethod || "GET").toUpperCase();
  if (method === "GET") {
    const row = await readProfile(user.org_id, user.user_id);
    return json(200, {
      ok: true,
      profile: row ? { ...row.payload || {}, updated_at: row.updated_at || null } : null,
      backend: "app_records"
    });
  }
  if (method === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    const profile = {
      user_id: user.user_id,
      email: user.email || "",
      full_name: String(body.full_name || "").trim(),
      plan_tier: String(body.plan_tier || "core").trim().toLowerCase(),
      shipping_name: String(body.shipping_name || "").trim(),
      shipping_email: String(body.shipping_email || user.email || "").trim(),
      shipping_address: String(body.shipping_address || "").trim(),
      shipping_city: String(body.shipping_city || "").trim(),
      shipping_state: String(body.shipping_state || "").trim(),
      shipping_zip: String(body.shipping_zip || "").trim(),
      shipping_country: String(body.shipping_country || "").trim(),
      thumb_drive_tier: tierDrive(String(body.plan_tier || "core")),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    const existing = await readProfile(user.org_id, user.user_id);
    if (existing?.id) {
      await q(
        `update app_records
            set title=$1, payload=$2::jsonb, updated_at=now()
          where id=$3 and org_id=$4`,
        ["SkyeVault Profile", JSON.stringify(profile), existing.id, user.org_id]
      );
    } else {
      await q(
        `insert into app_records(org_id, ws_id, app, title, payload, created_by)
         values($1,$2,$3,$4,$5::jsonb,$6)`,
        [user.org_id, null, APP_KEY, "SkyeVault Profile", JSON.stringify(profile), user.user_id]
      );
    }
    await audit(user.email, user.org_id, null, "vault.profile.saved", {
      plan_tier: profile.plan_tier,
      thumb_drive_tier: profile.thumb_drive_tier
    });
    return json(200, { ok: true, profile, backend: "app_records" });
  }
  return json(405, { error: "Method not allowed." });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=vault-profile.js.map
