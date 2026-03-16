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

// netlify/functions/integrations-status.ts
var integrations_status_exports = {};
__export(integrations_status_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(integrations_status_exports);

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

// netlify/functions/integrations-status.ts
var handler = async (event) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }
  const u = await requireUser(event);
  if (!u) return forbid();
  const result = await q(
    `select github_repo,
            github_owner,
            github_branch,
            github_installation_id,
            skyedrive_ws_id,
            skyedrive_record_id,
            skyedrive_title,
            netlify_site_id,
            netlify_site_name,
            updated_at
       from integrations
      where user_id=$1
      limit 1`,
    [u.user_id]
  );
  const row = result.rows[0] || null;
  const updatedAt = row?.updated_at || null;
  const githubRepo = String(row?.github_repo || "").trim();
  const githubBranch = String(row?.github_branch || "main").trim() || "main";
  const githubInstallationId = row?.github_installation_id ? Number(row.github_installation_id) : null;
  const skyeDriveWsId = String(row?.skyedrive_ws_id || "").trim();
  const skyeDriveRecordId = String(row?.skyedrive_record_id || "").trim();
  const skyeDriveTitle = String(row?.skyedrive_title || "").trim();
  const netlifySiteId = String(row?.netlify_site_id || "").trim();
  const netlifySiteName = String(row?.netlify_site_name || "").trim() || null;
  return json(200, {
    github: {
      connected: Boolean(githubRepo && githubInstallationId),
      repo: githubRepo || null,
      owner: String(row?.github_owner || "").trim() || null,
      branch: githubRepo ? githubBranch : null,
      installation_id: githubInstallationId,
      updated_at: updatedAt
    },
    skyedrive: {
      connected: Boolean(skyeDriveWsId && skyeDriveRecordId),
      ws_id: skyeDriveWsId || null,
      record_id: skyeDriveRecordId || null,
      title: skyeDriveTitle || null,
      updated_at: updatedAt
    },
    netlify: {
      connected: Boolean(netlifySiteId),
      site_id: netlifySiteId || null,
      site_name: netlifySiteName,
      updated_at: updatedAt
    }
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=integrations-status.js.map
