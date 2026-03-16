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

// netlify/functions/skychat-kaixu.ts
var skychat_kaixu_exports = {};
__export(skychat_kaixu_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_kaixu_exports);

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

// netlify/functions/_shared/skychat.ts
function normSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function channelSlugFromInput(value) {
  const slug = normSlug(value);
  return slug || "group";
}
async function findChannelBySlug(orgId, slug) {
  const row = await q(
    `select id, payload
     from app_records
     where org_id=$1
       and app='SkyeChatChannel'
       and lower(coalesce(payload->>'slug',''))=$2
     order by created_at asc
     limit 1`,
    [orgId, slug.toLowerCase()]
  );
  if (!row.rows.length) return null;
  const payload = row.rows[0]?.payload && typeof row.rows[0].payload === "object" ? row.rows[0].payload : {};
  return {
    id: row.rows[0].id,
    slug: String(payload.slug || "").toLowerCase(),
    name: String(payload.name || payload.slug || "Channel"),
    description: String(payload.description || ""),
    kind: String(payload.kind || "group").toLowerCase(),
    visibility: String(payload.visibility || "private").toLowerCase(),
    posting_policy: String(payload.posting_policy || "members").toLowerCase(),
    owner_user_id: payload.owner_user_id ? String(payload.owner_user_id) : null
  };
}
async function ensureCoreSkychatChannels(orgId, actorUserId) {
  const defaults = [
    {
      slug: "community",
      name: "Community Broadcast",
      description: "Global broadcast channel for all users in the organization.",
      kind: "broadcast",
      visibility: "public",
      posting_policy: "all"
    },
    {
      slug: "admin-board",
      name: "Admin Board",
      description: "Admin announcement board; updates fan out to every member notification inbox.",
      kind: "admin",
      visibility: "public",
      posting_policy: "admin"
    }
  ];
  for (const d of defaults) {
    await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       select $1, null, 'SkyeChatChannel', $2, $3::jsonb, $4
       where not exists (
         select 1
         from app_records
         where org_id=$1 and app='SkyeChatChannel' and lower(coalesce(payload->>'slug',''))=$5
       )`,
      [
        orgId,
        `#${d.slug}`,
        JSON.stringify({
          slug: d.slug,
          name: d.name,
          description: d.description,
          kind: d.kind,
          visibility: d.visibility,
          posting_policy: d.posting_policy,
          owner_user_id: null,
          system_default: true
        }),
        actorUserId,
        d.slug
      ]
    );
  }
}
async function getOrgRole(orgId, userId) {
  const roleRow = await q(
    "select role from org_memberships where org_id=$1 and user_id=$2 limit 1",
    [orgId, userId]
  );
  return roleRow.rows[0]?.role || null;
}
function isOrgAdmin(role) {
  return role === "owner" || role === "admin";
}
async function resolveAccessibleChannel(orgId, userId, role, slugRaw) {
  const slug = channelSlugFromInput(slugRaw || "community");
  const ch = await findChannelBySlug(orgId, slug);
  if (!ch) return null;
  const admin = isOrgAdmin(role);
  const isPublic = ch.visibility === "public";
  if (isPublic || admin) return ch;
  const membership = await q(
    `select id
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'channel_id'=$2
       and payload->>'user_id'=$3
       and coalesce(payload->>'status','')='active'
     limit 1`,
    [orgId, ch.id, userId]
  );
  if (!membership.rows.length) return null;
  return ch;
}
async function canPostToChannel(orgId, userId, role, channel) {
  if (channel.posting_policy === "all") return true;
  if (channel.posting_policy === "admin") return isOrgAdmin(role);
  if (isOrgAdmin(role)) return true;
  const membership = await q(
    `select id
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'channel_id'=$2
       and payload->>'user_id'=$3
       and coalesce(payload->>'status','')='active'
     limit 1`,
    [orgId, channel.id, userId]
  );
  return membership.rows.length > 0;
}

// netlify/functions/_shared/runner.ts
var import_crypto = __toESM(require("crypto"), 1);
async function runnerCallDetailed(path, payload) {
  const base = must("WORKER_RUNNER_URL").replace(/\/+$/g, "");
  const secret = must("RUNNER_SHARED_SECRET");
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  const ts = Date.now().toString();
  const body = JSON.stringify(payload ?? {});
  const canonical = `${ts}
${path}
${body}`;
  const hmac = import_crypto.default.createHmac("sha256", secret);
  hmac.update(canonical);
  const sig = hmac.digest("base64url");
  const headers = {
    "Content-Type": "application/json",
    "X-KX-TS": ts,
    "X-KX-SIG": sig
  };
  if (accessClientId && accessClientSecret) {
    headers["CF-Access-Client-Id"] = accessClientId;
    headers["CF-Access-Client-Secret"] = accessClientSecret;
  }
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return {
    status: res.status,
    data,
    headers: res.headers
  };
}

// netlify/functions/_shared/kaixu_brain.ts
function normalizeKaixuGatewayEndpoint(raw) {
  const endpoint = String(raw || "").trim();
  if (!endpoint) return endpoint;
  if (/^https:\/\/skyesol\.netlify\.app\/?$/i.test(endpoint)) {
    return "https://skyesol.netlify.app/.netlify/functions/gateway-chat";
  }
  if (/^https:\/\/skyesol\.netlify\.app\/platforms-apps-infrastructure\/kaixugateway13\/v1\/generate\/?$/i.test(endpoint)) {
    return "https://skyesol.netlify.app/.netlify/functions/gateway-chat";
  }
  return endpoint;
}
function resolveKaixuGatewayProvider(raw) {
  const value = String(raw || "").trim();
  return value || "Skyes Over London";
}
async function tokenFingerprint(token) {
  const normalized = String(token || "").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 4)}...len=${normalized.length} sha256=${hex.slice(0, 12)}`;
}
function compactErrorMessage(data, text) {
  const msg = typeof data?.error === "string" && data.error || typeof data?.message === "string" && data.message || typeof data?.raw === "string" && data.raw || text || "Brain request failed.";
  return String(msg).replace(/\s+/g, " ").trim().slice(0, 220);
}
function extractReply(data, text) {
  return String(data?.text || data?.output || data?.choices?.[0]?.message?.content || text || "").trim();
}
function pickFirstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  }
  return null;
}
function estimateTokens(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}
function summarizeMessages(messages) {
  return messages.map((message) => `${String(message?.role || "user")}: ${String(message?.content || "")}`.trim()).filter(Boolean).join("\n\n");
}
function extractUsage(data, messages, reply) {
  const usage = data?.usage || data?.meta?.usage || data?.metrics?.usage || {};
  const promptTokens = pickFirstNumber(
    usage?.prompt_tokens,
    usage?.input_tokens,
    usage?.promptTokenCount,
    usage?.inputTokenCount,
    data?.prompt_tokens,
    data?.input_tokens
  );
  const completionTokens = pickFirstNumber(
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.candidates_token_count,
    usage?.candidatesTokenCount,
    usage?.outputTokenCount,
    data?.completion_tokens,
    data?.output_tokens
  );
  const totalTokens = pickFirstNumber(
    usage?.total_tokens,
    usage?.totalTokenCount,
    data?.total_tokens,
    promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null
  );
  if (promptTokens != null || completionTokens != null || totalTokens != null) {
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens != null ? totalTokens : (promptTokens || 0) + (completionTokens || 0),
      exact: true,
      source: "provider"
    };
  }
  const estimatedPrompt = estimateTokens(summarizeMessages(messages));
  const estimatedCompletion = estimateTokens(reply);
  return {
    prompt_tokens: estimatedPrompt,
    completion_tokens: estimatedCompletion,
    total_tokens: estimatedPrompt == null && estimatedCompletion == null ? null : (estimatedPrompt || 0) + (estimatedCompletion || 0),
    exact: false,
    source: "estimated"
  };
}
function shouldUseBackup(status, error) {
  if (status == null) return true;
  return status === 429 || status >= 500;
}
async function callPrimaryBrain(endpoint, token, payload, messages) {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    const requestId = String(res.headers.get("x-kaixu-request-id") || data?.brain?.request_id || "").trim() || null;
    const reply = extractReply(data, text);
    const usage = extractUsage(data, messages, reply);
    if (res.ok && reply) {
      return {
        ok: true,
        status: res.status,
        text: reply,
        error: "",
        detail: null,
        requestId,
        usage
      };
    }
    return {
      ok: false,
      status: res.status,
      text: "",
      error: compactErrorMessage(data, text),
      detail: text.slice(0, 2e3) || null,
      requestId,
      usage
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      text: "",
      error: String(e?.message || "Primary brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
      detail: null,
      requestId: null,
      usage: extractUsage(null, messages, "")
    };
  }
}
async function callBackupBrain(payload, messages) {
  try {
    const { status, data } = await runnerCallDetailed("/v1/brain/backup/generate", payload);
    const requestId = String(data?.brain?.request_id || "").trim() || null;
    const reply = extractReply(data, "");
    const usage = extractUsage(data, messages, reply);
    if (status >= 200 && status < 300 && reply) {
      return {
        ok: true,
        status,
        text: reply,
        error: "",
        detail: null,
        requestId,
        usage
      };
    }
    return {
      ok: false,
      status,
      text: "",
      error: compactErrorMessage(data, ""),
      detail: JSON.stringify(data || {}).slice(0, 2e3) || null,
      requestId,
      usage
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      text: "",
      error: String(e?.message || "Backup brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
      detail: null,
      requestId: null,
      usage: extractUsage(null, messages, "")
    };
  }
}
async function callKaixuBrainWithFailover({
  bodyModel,
  defaultModel,
  providerRaw,
  messages,
  requestContext
}) {
  const endpoint = normalizeKaixuGatewayEndpoint(must("KAIXU_GATEWAY_ENDPOINT"));
  const token = must("KAIXU_APP_TOKEN");
  const tokenFp = await tokenFingerprint(token);
  const configuredProvider = String(providerRaw || "Skyes Over London").trim() || "Skyes Over London";
  const provider = resolveKaixuGatewayProvider(configuredProvider);
  const model = String(bodyModel || defaultModel || "kAIxU-Prime6.7").trim() || "kAIxU-Prime6.7";
  const billing = {
    actor_email: requestContext?.actor_email || null,
    actor_user_id: requestContext?.actor_user_id || null,
    auth_type: requestContext?.auth_type || "unknown",
    api_token_id: requestContext?.api_token_id || null,
    api_token_label: requestContext?.api_token_label || null,
    api_token_locked_email: requestContext?.api_token_locked_email || null
  };
  const payload = {
    provider,
    model,
    messages
  };
  const primary = await callPrimaryBrain(endpoint, token, payload, messages);
  if (primary.ok) {
    return {
      ok: true,
      text: primary.text,
      brain: {
        route: "primary",
        provider,
        model,
        request_id: primary.requestId
      },
      gateway_endpoint: endpoint,
      gateway_status: primary.status,
      gateway_request_id: primary.requestId,
      backup_status: null,
      backup_request_id: null,
      token_fingerprint: tokenFp,
      configured_provider: configuredProvider,
      effective_provider: provider,
      effective_model: model,
      used_backup: false,
      usage: primary.usage,
      billing
    };
  }
  let backup = null;
  if (shouldUseBackup(primary.status, primary.error)) {
    backup = await callBackupBrain({
      ...payload,
      request_context: requestContext || {},
      brain_policy: {
        allow_backup: true,
        allow_user_direct: false
      }
    }, messages);
  }
  if (backup?.ok) {
    return {
      ok: true,
      text: backup.text,
      brain: {
        route: "backup",
        provider,
        model,
        request_id: backup.requestId
      },
      gateway_endpoint: endpoint,
      gateway_status: primary.status,
      gateway_request_id: primary.requestId,
      backup_status: backup.status,
      backup_request_id: backup.requestId,
      token_fingerprint: tokenFp,
      configured_provider: configuredProvider,
      effective_provider: provider,
      effective_model: model,
      used_backup: true,
      usage: backup.usage,
      billing
    };
  }
  const primaryMsg = primary.status ? `Kaixu gateway call failed (${primary.status})${primary.requestId ? ` [${primary.requestId}]` : ""}: ${primary.error}` : `Kaixu gateway call failed: ${primary.error}`;
  const backupMsg = backup ? ` Backup brain unavailable${backup.status ? ` (${backup.status})` : ""}${backup.requestId ? ` [${backup.requestId}]` : ""}: ${backup.error}` : "";
  return {
    ok: false,
    status: 502,
    error: `${primaryMsg}${backupMsg}`.trim(),
    brain: {
      route: backup ? "backup" : "primary",
      failed: true,
      provider,
      model,
      request_id: backup?.requestId || primary.requestId || null
    },
    gateway_endpoint: endpoint,
    gateway_status: primary.status,
    gateway_request_id: primary.requestId,
    gateway_detail: primary.detail,
    backup_status: backup?.status || null,
    backup_request_id: backup?.requestId || null,
    backup_detail: backup?.detail || null,
    backup_error: backup?.error || null,
    token_fingerprint: tokenFp,
    configured_provider: configuredProvider,
    effective_provider: provider,
    effective_model: model,
    used_backup: false,
    usage: backup?.usage || primary.usage,
    billing
  };
}

// netlify/functions/_shared/brain_usage.ts
async function recordBrainUsage(meta) {
  try {
    await q(
      `insert into ai_brain_usage_log(
        actor,
        actor_email,
        actor_user_id,
        org_id,
        ws_id,
        app,
        auth_type,
        api_token_id,
        api_token_label,
        api_token_locked_email,
        used_backup,
        brain_route,
        provider,
        model,
        gateway_request_id,
        backup_request_id,
        gateway_status,
        backup_status,
        usage_json,
        billing_json,
        success
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21
      )`,
      [
        meta.actor,
        meta.actor_email || null,
        meta.actor_user_id || null,
        meta.org_id || null,
        meta.ws_id || null,
        meta.app,
        meta.auth_type || "unknown",
        meta.api_token_id || null,
        meta.api_token_label || null,
        meta.api_token_locked_email || null,
        Boolean(meta.used_backup),
        meta.brain_route,
        meta.provider || null,
        meta.model || null,
        meta.gateway_request_id || null,
        meta.backup_request_id || null,
        meta.gateway_status ?? null,
        meta.backup_status ?? null,
        JSON.stringify(meta.usage || {}),
        JSON.stringify(meta.billing || {}),
        meta.success !== false
      ]
    );
  } catch {
  }
}

// netlify/functions/skychat-kaixu.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }
  const channel = String(body.channel || "community").trim();
  const message = String(body.message || "").trim();
  const wsId = String(body.ws_id || "").trim();
  if (!channel || !message) {
    return json(400, { error: "Missing channel or message." });
  }
  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  const channelInfo = await resolveAccessibleChannel(u.org_id, u.user_id, orgRole, channel);
  if (!channelInfo) return json(403, { error: "Channel access denied." });
  const canPost = await canPostToChannel(u.org_id, u.user_id, orgRole, channelInfo);
  if (!canPost) return json(403, { error: "Posting denied for this channel." });
  const effectiveWsId = channelInfo.kind === "group" ? wsId || null : null;
  const userRow = await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id",
    [
      u.org_id,
      effectiveWsId,
      "SkyeChat",
      `#${channelInfo.slug}`,
      JSON.stringify({
        channel: channelInfo.slug,
        channel_slug: channelInfo.slug,
        channel_id: channelInfo.id,
        channel_kind: channelInfo.kind,
        message,
        source: "SkyeChat user",
        role: "user"
      }),
      u.user_id
    ]
  );
  const contextRows = await q(
    `select payload
     from app_records
     where org_id=$1
       and app='SkyeChat'
       and lower(coalesce(payload->>'channel_slug', payload->>'channel',''))=$2
     order by created_at desc
     limit 10`,
    [u.org_id, channelInfo.slug]
  );
  const recentContext = contextRows.rows.map((row) => {
    const p = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const src = String(p.source || "user").slice(0, 48);
    const msg = String(p.message || "").replace(/\s+/g, " ").slice(0, 240);
    return `${src}: ${msg}`;
  }).filter(Boolean).reverse();
  const providerRaw = opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London");
  const modelRaw = opt("KAIXU_GATEWAY_MODEL", "kAIxU-Prime6.7");
  const prompt = [
    `Channel: #${channel}`,
    `Channel Type: ${channelInfo.kind}`,
    `User: ${u.email}`,
    `Message: ${message}`,
    recentContext.length ? `Recent Context:
${recentContext.join("\n")}` : "Recent Context: none",
    "Respond as kAIxU assistant in concise team-chat style."
  ].join("\n");
  const payload = {
    messages: [
      {
        role: "system",
        content: "You are kAIxU collaborating in SkyeChat. Keep responses concise, useful, and execution-oriented."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
  const result = await callKaixuBrainWithFailover({
    bodyModel: body.model,
    defaultModel: modelRaw,
    providerRaw,
    messages: payload.messages,
    requestContext: {
      ws_id: effectiveWsId,
      app: "SkyeChat",
      actor_email: u.email,
      actor_org: u.org_id,
      actor_user_id: u.user_id,
      auth_type: "session"
    }
  });
  if (!result.ok) {
    await audit(u.email, u.org_id, wsId || null, "skychat.kaixu.failed", {
      channel,
      channel_kind: channelInfo.kind,
      user_record_id: userRow.rows[0]?.id || null,
      gateway_status: result.gateway_status,
      gateway_error: result.error,
      gateway_body: result.gateway_detail,
      gateway_request_id: result.gateway_request_id,
      backup_status: result.backup_status,
      backup_request_id: result.backup_request_id,
      backup_error: result.backup_error,
      token_fingerprint: result.token_fingerprint,
      configured_provider: result.configured_provider,
      effective_provider: result.effective_provider,
      effective_model: result.effective_model,
      brain_route: result.brain.route,
      usage: result.usage,
      billing: result.billing
    });
    return json(result.status, {
      ok: false,
      error: result.error,
      brain: result.brain,
      gateway_endpoint: result.gateway_endpoint,
      gateway_status: result.gateway_status,
      gateway_request_id: result.gateway_request_id,
      gateway_detail: result.gateway_detail,
      backup_status: result.backup_status,
      backup_request_id: result.backup_request_id,
      backup_detail: result.backup_detail,
      backup_error: result.backup_error,
      token_fingerprint: result.token_fingerprint,
      configured_provider: result.configured_provider,
      effective_provider: result.effective_provider,
      effective_model: result.effective_model,
      usage: result.usage,
      billing: result.billing
    });
  }
  const aiRow = await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id, created_at",
    [
      u.org_id,
      effectiveWsId,
      "SkyeChat",
      `#${channelInfo.slug}`,
      JSON.stringify({
        channel: channelInfo.slug,
        channel_slug: channelInfo.slug,
        channel_id: channelInfo.id,
        channel_kind: channelInfo.kind,
        message: result.text,
        source: "kAIxU",
        role: "assistant"
      }),
      u.user_id
    ]
  );
  await audit(u.email, u.org_id, effectiveWsId, "skychat.kaixu.ok", {
    channel: channelInfo.slug,
    channel_kind: channelInfo.kind,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    brain_route: result.brain.route,
    brain_request_id: result.brain.request_id,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing
  });
  await recordBrainUsage({
    actor: u.email,
    actor_email: u.email,
    actor_user_id: u.user_id,
    org_id: u.org_id,
    ws_id: effectiveWsId,
    app: "SkyeChat",
    auth_type: "session",
    used_backup: result.used_backup,
    brain_route: result.brain.route,
    provider: result.effective_provider,
    model: result.effective_model,
    gateway_request_id: result.gateway_request_id,
    backup_request_id: result.backup_request_id,
    gateway_status: result.gateway_status,
    backup_status: result.backup_status,
    usage: result.usage,
    billing: result.billing,
    success: true
  });
  return json(200, {
    ok: true,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    ai_message: result.text,
    brain: result.brain,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing,
    created_at: aiRow.rows[0]?.created_at || null
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-kaixu.js.map
