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

// netlify/functions/ai-vault.ts
var ai_vault_exports = {};
__export(ai_vault_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(ai_vault_exports);

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

// netlify/functions/ai-vault.ts
var handler = async (event) => {
  const user = await requireUser(event);
  if (!user) return forbid();
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const prompt = String(body.prompt || "").trim();
  const corpus = Array.isArray(body.corpus) ? body.corpus.slice(0, 80) : [];
  if (!prompt) return json(400, { error: "Prompt is required." });
  const modelRaw = "kAIxU-Prime6.7";
  const providerRaw = "Skyes Over London";
  const requestedModel = String(body.model || "").trim() || void 0;
  const actorEmail = String(user.email || "unknown").trim() || "unknown";
  const promptText = `User request:
${prompt}

Vault corpus:
${JSON.stringify(corpus, null, 2)}`;
  await audit(actorEmail, user.org_id, null, "vault.ai.requested", {
    corpus_items: corpus.length
  });
  const result = await callKaixuBrainWithFailover({
    bodyModel: requestedModel,
    defaultModel: modelRaw,
    providerRaw,
    messages: [
      {
        role: "system",
        content: "You are helping a user search and reason over a personal file vault. Use only the supplied vault corpus. Be practical, concise, and cite file paths plainly when useful. If the corpus is insufficient, say so."
      },
      {
        role: "user",
        content: promptText
      }
    ],
    requestContext: {
      ws_id: null,
      activePath: null,
      app: "SkyeVault-Pro-v4.46",
      actor_email: actorEmail,
      actor_org: user.org_id || null,
      actor_user_id: user.user_id,
      auth_type: "session",
      api_token_id: null,
      api_token_label: null,
      api_token_locked_email: null
    }
  });
  if (!result.ok) {
    await audit(actorEmail, user.org_id, null, "vault.ai.failed", {
      error: result.error,
      gateway_status: result.gateway_status,
      backup_status: result.backup_status,
      used_backup: result.used_backup,
      usage: result.usage,
      billing: result.billing
    });
    return json(result.status, {
      ok: false,
      error: result.error,
      brain: result.brain,
      used_backup: result.used_backup,
      usage: result.usage,
      billing: result.billing
    });
  }
  await recordBrainUsage({
    actor: actorEmail,
    actor_email: actorEmail,
    actor_user_id: user.user_id,
    org_id: user.org_id || null,
    ws_id: null,
    app: "SkyeVault-Pro-v4.46",
    auth_type: "session",
    api_token_id: null,
    api_token_label: null,
    api_token_locked_email: null,
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
  await audit(actorEmail, user.org_id, null, "vault.ai.ok", {
    used_backup: result.used_backup,
    brain_route: result.brain.route,
    usage: result.usage,
    billing: result.billing
  });
  return json(200, {
    ok: true,
    model: result.effective_model,
    text: result.text,
    brain: result.brain,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=ai-vault.js.map
