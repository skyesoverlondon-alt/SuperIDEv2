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

// netlify/functions/ai-agent.ts
var ai_agent_exports = {};
__export(ai_agent_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(ai_agent_exports);

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

// netlify/functions/_shared/rbac.ts
async function getOrgRole(orgId, userId) {
  const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [orgId, userId]);
  return r.rows[0]?.role || null;
}
async function getWorkspaceRole(wsId, userId) {
  const r = await q("select role from workspace_memberships where ws_id=$1 and user_id=$2 limit 1", [wsId, userId]);
  return r.rows[0]?.role || null;
}
async function canReadWorkspace(orgId, userId, wsId) {
  const orgRole = await getOrgRole(orgId, userId);
  if (!orgRole) return false;
  if (orgRole === "owner" || orgRole === "admin") return true;
  const wsRole = await getWorkspaceRole(wsId, userId);
  if (wsRole) return true;
  const c = await q("select count(*)::int as c from workspace_memberships where ws_id=$1", [wsId]);
  const hasScopedMemberships = Number(c.rows[0]?.c || 0) > 0;
  if (!hasScopedMemberships) return true;
  return false;
}

// netlify/functions/_shared/api_tokens.ts
var import_crypto = __toESM(require("crypto"), 1);
function tokenHash(token) {
  return import_crypto.default.createHash("sha256").update(token).digest("hex");
}
async function resolveApiToken(token) {
  const hash = tokenHash(token);
  const res = await q(
    "select id, org_id, label, issued_by, locked_email, scopes_json from api_tokens where token_hash=$1 and status='active' and (expires_at is null or expires_at > now()) limit 1",
    [hash]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  await q("update api_tokens set last_used_at=now() where id=$1", [row.id]);
  return {
    id: row.id,
    org_id: row.org_id,
    label: row.label || null,
    issued_by: row.issued_by || null,
    locked_email: row.locked_email || null,
    scopes: Array.isArray(row.scopes_json) ? row.scopes_json.map(String) : ["generate"]
  };
}
function readBearerToken(headers) {
  const value = headers.authorization || headers.Authorization || headers.AUTHORIZATION || "";
  const m = value.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
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
function tokenHasScope(scopes, required) {
  const actual = Array.isArray(scopes) ? scopes : [];
  return actual.includes(required) || actual.includes("admin");
}

// netlify/functions/_shared/sknore.ts
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegex(glob) {
  const normalized = glob.trim().replace(/^\/+/, "");
  const escaped = escapeRegex(normalized).replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`, "i");
}
function normalizeSknorePatterns(patterns) {
  return Array.from(
    new Set(
      (patterns || []).map((p) => String(p || "").trim()).filter(Boolean).map((p) => p.replace(/^\/+/, ""))
    )
  );
}
function isSknoreProtected(path, patterns) {
  const target = String(path || "").replace(/^\/+/, "");
  const normalized = normalizeSknorePatterns(patterns);
  return normalized.some((pattern) => globToRegex(pattern).test(target));
}
function filterSknoreFiles(files, patterns) {
  return (files || []).filter((f) => !isSknoreProtected(f.path, patterns));
}
async function loadSknorePolicy(orgId, wsId) {
  const scoped = wsId ? await q(
    `select payload
         from app_records
         where org_id=$1 and app='SKNorePolicy' and ws_id=$2
         order by updated_at desc
         limit 1`,
    [orgId, wsId]
  ) : { rows: [] };
  if (scoped.rows.length) {
    const payload2 = scoped.rows[0]?.payload || {};
    return normalizeSknorePatterns(Array.isArray(payload2.patterns) ? payload2.patterns : []);
  }
  const orgWide = await q(
    `select payload
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ws_id is null
     order by updated_at desc
     limit 1`,
    [orgId]
  );
  if (!orgWide.rows.length) return [];
  const payload = orgWide.rows[0]?.payload || {};
  return normalizeSknorePatterns(Array.isArray(payload.patterns) ? payload.patterns : []);
}

// netlify/functions/_shared/runner.ts
var import_crypto2 = __toESM(require("crypto"), 1);
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
  const hmac = import_crypto2.default.createHmac("sha256", secret);
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

// netlify/functions/_shared/agent_workspace.ts
function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}
function isLikelyTextPath(path) {
  return !/\.(png|jpe?g|gif|webp|pdf|woff2?|ttf|ico|mp4|mp3|mov|avi|wasm|lock|zip|gz|tar|bin)$/i.test(path);
}
function extname(path) {
  const clean = normalizePath(path);
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : "";
}
function basename(path) {
  const clean = normalizePath(path);
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}
function tokenizePrompt(prompt) {
  return Array.from(
    new Set(
      String(prompt || "").toLowerCase().replace(/[^a-z0-9_./ -]+/g, " ").split(/\s+/).map((token) => token.trim()).filter((token) => token.length >= 2)
    )
  );
}
function scorePathForPrompt(path, prompt) {
  const tokens = tokenizePrompt(prompt);
  const lowerPath = normalizePath(path).toLowerCase();
  const name = basename(lowerPath);
  let score = 0;
  for (const token of tokens) {
    if (lowerPath.includes(token)) score += token.length > 4 ? 8 : 4;
    if (name === token) score += 12;
    if (name.startsWith(token)) score += 6;
  }
  if (/readme|package\.json|netlify\.toml|vite\.config|tsconfig|manifest\.json|index\.html/.test(lowerPath)) score += 6;
  if (/app\.|editor\.|styles\.|worker\//.test(lowerPath)) score += 4;
  if (/test|spec/.test(lowerPath) && /test|bug|fail|error|fix|regression/.test(prompt.toLowerCase())) score += 5;
  return score;
}
function snippetForContent(content, maxChars) {
  const text = String(content || "");
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.78));
  const tail = text.slice(-Math.floor(maxChars * 0.18));
  return `${head}
/* ... truncated for context ... */
${tail}`;
}
function normalizeWorkspaceFiles(input) {
  const deduped = /* @__PURE__ */ new Map();
  const items = Array.isArray(input) ? input : [];
  for (const raw of items) {
    const path = normalizePath(raw?.path);
    if (!path || !isLikelyTextPath(path)) continue;
    deduped.set(path, {
      path,
      content: typeof raw?.content === "string" ? raw.content : ""
    });
  }
  return Array.from(deduped.values()).sort((a, b) => a.path.localeCompare(b.path));
}
function summarizeWorkspace(files) {
  const languageCounts = files.reduce((acc, file) => {
    const extension = extname(file.path) || "txt";
    acc[extension] = (acc[extension] || 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([language, count]) => `${language} ${count}`).join(" | ");
  return `${files.length} files${top ? ` | ${top}` : ""}`;
}
function buildProjectMap(files, maxLines = 140) {
  const lines = [];
  for (const file of files) {
    if (lines.length >= maxLines) {
      lines.push(`... (${files.length - maxLines} more files)`);
      break;
    }
    lines.push(`${file.path} | ${String(file.content || "").length}b`);
  }
  return lines.join("\n");
}
function buildSeedContext(files, prompt, options = {}) {
  const depth = options.depth || "balanced";
  const maxFiles = depth === "deep" ? 18 : depth === "light" ? 8 : 12;
  const maxSnippetChars = depth === "deep" ? 12e3 : 7e3;
  const ranked = files.filter((file) => isLikelyTextPath(file.path)).map((file) => ({ ...file, score: scorePathForPrompt(file.path, prompt) })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });
  const selected = ranked.slice(0, maxFiles);
  return {
    selected: selected.map((file) => file.path),
    context: selected.map((file) => `FILE: ${file.path}
${snippetForContent(file.content, maxSnippetChars)}`).join("\n\n---\n\n")
  };
}
function sanitizeOperations(input) {
  const operations = Array.isArray(input) ? input : [];
  const sanitized = [];
  const seenDeletes = /* @__PURE__ */ new Set();
  for (const raw of operations) {
    const type = String(raw?.type || "").trim().toLowerCase();
    if ((type === "create" || type === "update") && typeof raw?.path === "string") {
      sanitized.push({
        type,
        path: normalizePath(raw.path),
        content: typeof raw?.content === "string" ? raw.content : ""
      });
      continue;
    }
    if (type === "delete" && typeof raw?.path === "string") {
      const path = normalizePath(raw.path);
      if (!path || seenDeletes.has(path)) continue;
      seenDeletes.add(path);
      sanitized.push({ type: "delete", path });
      continue;
    }
    if (type === "rename" && typeof raw?.from === "string" && typeof raw?.to === "string") {
      const from = normalizePath(raw.from);
      const to = normalizePath(raw.to);
      if (!from || !to || from === to) continue;
      sanitized.push({ type: "rename", from, to });
    }
  }
  return sanitized;
}
function applyOperationsToWorkspace(files, operations) {
  const map = new Map(files.map((file) => [file.path, { ...file }]));
  const touched = /* @__PURE__ */ new Set();
  for (const operation of operations) {
    if (operation.type === "create" || operation.type === "update") {
      map.set(operation.path, { path: operation.path, content: operation.content });
      touched.add(operation.path);
      continue;
    }
    if (operation.type === "delete") {
      map.delete(operation.path);
      touched.add(operation.path);
      continue;
    }
    if (operation.type === "rename") {
      const existing = map.get(operation.from);
      map.delete(operation.from);
      map.set(operation.to, { path: operation.to, content: existing?.content || "" });
      touched.add(operation.from);
      touched.add(operation.to);
    }
  }
  return {
    files: Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path)),
    touched: Array.from(touched)
  };
}

// netlify/functions/ai-agent.ts
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function normalizeMode(input) {
  return String(input || "").trim().toLowerCase() === "plan" ? "plan" : "execute";
}
function normalizeAutonomy(input) {
  return String(input || "").trim().toLowerCase() === "autonomous" ? "autonomous" : "controlled";
}
function extractJsonPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const directCandidates = [text];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) directCandidates.push(fenced[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    directCandidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
    }
  }
  return null;
}
function normalizeStructuredReply(rawText, payload) {
  const summary = String(payload?.summary || payload?.message || rawText || "No summary provided.").replace(/\s+/g, " ").trim();
  const changes = Array.isArray(payload?.changes) ? payload.changes.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const risks = Array.isArray(payload?.risks) ? payload.risks.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const next = String(payload?.next || "Review the staged operations and run validation before shipping.").replace(/\s+/g, " ").trim();
  return {
    summary: summary || "No summary provided.",
    changes,
    risks,
    next,
    done: Boolean(payload?.done),
    operations: sanitizeOperations(payload?.operations)
  };
}
function formatReply(reply) {
  const lines = [
    "SUMMARY:",
    `- ${reply.summary}`,
    "",
    "CHANGES:",
    ...reply.changes.length ? reply.changes.map((item) => `- ${item}`) : ["- No explicit file list was returned."],
    "",
    "RISKS:",
    ...reply.risks.length ? reply.risks.map((item) => `- ${item}`) : ["- none obvious"],
    "",
    "NEXT:",
    `- ${reply.next}`
  ];
  return lines.join("\n");
}
function summarizeOperations(operations) {
  return operations.reduce((acc, operation) => {
    acc[operation.type] = (acc[operation.type] || 0) + 1;
    return acc;
  }, {});
}
function buildSystemPrompt({
  mode,
  autonomy,
  workspaceName,
  agentMemory,
  activePath,
  projectMap,
  workspaceSummary,
  seededFiles,
  iteration,
  maxIterations
}) {
  return [
    "You are kAIx4nthi4 4.6 operating as the autonomous SkyDex coding agent.",
    "Respond with JSON only. Do not wrap it in markdown fences.",
    "Respect the current workspace structure and preserve behavior unless the task explicitly asks for changes.",
    mode === "plan" ? "You are in PLAN mode. Propose preview operations only; they will not be applied yet." : autonomy === "autonomous" ? "You are in EXECUTE mode with autonomous iteration. Return the next concrete full-file operations needed for this iteration." : "You are in EXECUTE mode with controlled iteration. Return only the next concrete full-file operations for a single pass.",
    "Every create or update operation must contain the COMPLETE file content.",
    "Allowed operation types: create, update, delete, rename.",
    "If no file changes are needed, return an empty operations array and done=true.",
    "Output schema:",
    '{"summary":"string","changes":["string"],"risks":["string"],"next":"string","done":true,"operations":[{"type":"update","path":"src/file.ts","content":"full file content"}]}',
    `workspace_name: ${workspaceName}`,
    `workspace_summary: ${workspaceSummary}`,
    `active_path: ${activePath || "none"}`,
    `iteration: ${iteration}/${maxIterations}`,
    seededFiles.length ? `seeded_files: ${seededFiles.join(" | ")}` : "seeded_files: none",
    agentMemory ? `workspace_conventions: ${agentMemory}` : "workspace_conventions: none",
    "project_map:",
    projectMap || "(empty workspace)"
  ].join("\n\n");
}
function buildUserPrompt({
  prompt,
  seedContext,
  priorReply,
  priorOperations
}) {
  const sections = [`TASK:
${prompt}`];
  if (seedContext) sections.push(`HIGH_SIGNAL_CONTEXT:
${seedContext}`);
  if (priorReply) {
    sections.push(`PREVIOUS_RESULT:
${formatReply(priorReply)}`);
  }
  if (priorOperations.length) {
    sections.push(
      `OPERATIONS_ALREADY_STAGED:
${priorOperations.map((operation) => {
        if (operation.type === "rename") return `- rename ${operation.from} -> ${operation.to}`;
        if (operation.type === "delete") return `- delete ${operation.path}`;
        return `- ${operation.type} ${operation.path}`;
      }).join("\n")}`
    );
  }
  return sections.join("\n\n");
}
var handler = async (event) => {
  const user = await requireUser(event);
  const bearer = readBearerToken(event.headers || {});
  const tokenPrincipal = bearer ? await resolveApiToken(bearer) : null;
  if (!user && !tokenPrincipal) return forbid();
  const headers = event.headers || {};
  const tokenEmailHeader = String(headers["x-token-email"] || headers["X-Token-Email"] || "").trim().toLowerCase();
  const tokenMasterHeader = String(headers["x-token-master-sequence"] || headers["X-Token-Master-Sequence"] || "").trim();
  const tokenMasterExpected = opt("TOKEN_MASTER_SEQUENCE", "");
  const tokenMasterBypass = hasValidMasterSequence(tokenMasterHeader, tokenMasterExpected);
  if (tokenPrincipal?.locked_email && !tokenMasterBypass) {
    if (!tokenEmailHeader || tokenEmailHeader !== tokenPrincipal.locked_email.toLowerCase()) {
      return json(401, { error: "Token email lock mismatch." });
    }
  }
  if (tokenPrincipal && !tokenHasScope(tokenPrincipal.scopes, "generate")) {
    return json(403, { error: "Token missing required scope: generate" });
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  const wsId = String(body.ws_id || "").trim();
  const prompt = String(body.prompt || "").trim();
  const activePath = String(body.activePath || "").trim();
  const mode = normalizeMode(body.mode);
  const autonomy = normalizeAutonomy(body.autonomy);
  const smartContext = body.smartContext !== false;
  const contextDepth = String(body.contextDepth || "balanced").trim().toLowerCase() === "light" ? "light" : String(body.contextDepth || "balanced").trim().toLowerCase() === "deep" ? "deep" : "balanced";
  const maxIterations = clamp(Number(body.max_iterations ?? body.maxIterations ?? (autonomy === "autonomous" ? 3 : 1)), 1, mode === "plan" ? 1 : 6);
  const operationBudget = clamp(Number(body.operationBudget || 24), 1, 96);
  const agentMemory = String(body.agentMemory || "").trim().slice(0, 4e3);
  if (!wsId || !prompt) {
    return json(400, { error: "Missing ws_id or prompt." });
  }
  const workspaceResult = await q(
    "select id, org_id, name, files_json from workspaces where id=$1 limit 1",
    [wsId]
  );
  const workspace = workspaceResult.rows[0] || null;
  if (!workspace) return json(404, { error: "Workspace not found." });
  if (user?.org_id) {
    if (workspace.org_id !== user.org_id) return forbid();
    const allowed = await canReadWorkspace(user.org_id, user.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace read denied." });
  } else if (tokenPrincipal?.org_id) {
    if (workspace.org_id !== tokenPrincipal.org_id) {
      return json(403, { error: "Workspace access denied for token org." });
    }
  }
  const actorEmail = user?.email || `token:${tokenPrincipal?.label || tokenPrincipal?.id || "unknown"}`;
  const actorOrg = user?.org_id || tokenPrincipal?.org_id || null;
  const sknorePatterns = await loadSknorePolicy(actorOrg, wsId || null);
  if (activePath && isSknoreProtected(activePath, sknorePatterns)) {
    await audit(actorEmail, actorOrg, wsId, "skydex.agent.blocked_active_path", { activePath });
    return json(403, {
      error: `SKNore policy blocks active file: ${activePath}`,
      code: "SKNORE_BLOCKED_ACTIVE_PATH"
    });
  }
  const rawFiles = Array.isArray(body.files) && body.files.length ? body.files : workspace.files_json || [];
  const filteredFiles = filterSknoreFiles(rawFiles, sknorePatterns);
  const initialFiles = normalizeWorkspaceFiles(filteredFiles);
  await audit(actorEmail, actorOrg, wsId, "skydex.agent.requested", {
    mode,
    autonomy,
    prompt_chars: prompt.length,
    files: initialFiles.length,
    smart_context: smartContext,
    context_depth: contextDepth,
    max_iterations: maxIterations,
    operation_budget: operationBudget
  });
  let currentFiles = initialFiles;
  let stagedOperations = [];
  let finalReply = null;
  let rawReply = "";
  let usedBrain = null;
  let usedUsage = null;
  let usedBilling = null;
  let usedGatewayStatus = null;
  let usedBackupStatus = null;
  let usedGatewayRequestId = null;
  let usedBackupRequestId = null;
  let seededFiles = [];
  const touched = /* @__PURE__ */ new Set();
  try {
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const workspaceSummary = summarizeWorkspace(currentFiles);
      const projectMap = buildProjectMap(currentFiles, contextDepth === "deep" ? 220 : 140);
      const seed = smartContext ? buildSeedContext(currentFiles, prompt, { depth: contextDepth }) : { selected: [], context: "" };
      if (!seededFiles.length) seededFiles = seed.selected;
      const result = await callKaixuBrainWithFailover({
        bodyModel: body.model,
        defaultModel: "kAIxU-Prime6.7",
        providerRaw: opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London"),
        messages: [
          {
            role: "system",
            content: buildSystemPrompt({
              mode,
              autonomy,
              workspaceName: String(workspace.name || "SkyDex Workspace"),
              agentMemory,
              activePath,
              projectMap,
              workspaceSummary,
              seededFiles: seed.selected,
              iteration,
              maxIterations
            })
          },
          {
            role: "user",
            content: buildUserPrompt({
              prompt,
              seedContext: seed.context,
              priorReply: finalReply,
              priorOperations: stagedOperations
            })
          }
        ],
        requestContext: {
          ws_id: wsId,
          activePath: activePath || null,
          app: "SkyDex4.6",
          actor_email: actorEmail,
          actor_org: actorOrg,
          actor_user_id: u?.user_id || null,
          auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
          api_token_id: tokenPrincipal?.id || null,
          api_token_label: tokenPrincipal?.label || null,
          api_token_locked_email: tokenPrincipal?.locked_email || null
        }
      });
      if (!result.ok) {
        await audit(actorEmail, actorOrg, wsId, "skydex.agent.failed", {
          mode,
          autonomy,
          error: result.error,
          brain: result.brain,
          usage: result.usage,
          billing: result.billing
        });
        return json(result.status, {
          ok: false,
          error: result.error,
          brain: result.brain,
          usage: result.usage,
          billing: result.billing
        });
      }
      rawReply = result.text;
      usedBrain = result.brain;
      usedUsage = result.usage;
      usedBilling = result.billing;
      usedGatewayStatus = result.gateway_status;
      usedBackupStatus = result.backup_status;
      usedGatewayRequestId = result.gateway_request_id;
      usedBackupRequestId = result.backup_request_id;
      const payload = extractJsonPayload(result.text);
      finalReply = normalizeStructuredReply(result.text, payload || {});
      let nextOperations = finalReply.operations;
      const remainingBudget = Math.max(0, operationBudget - stagedOperations.length);
      if (remainingBudget === 0) nextOperations = [];
      if (nextOperations.length > remainingBudget) nextOperations = nextOperations.slice(0, remainingBudget);
      finalReply.operations = nextOperations;
      if (nextOperations.length) {
        stagedOperations = [...stagedOperations, ...nextOperations];
        for (const operation of nextOperations) {
          if (operation.type === "rename") {
            touched.add(operation.from);
            touched.add(operation.to);
          } else {
            touched.add(operation.path);
          }
        }
      }
      if (mode === "execute" && nextOperations.length) {
        currentFiles = applyOperationsToWorkspace(currentFiles, nextOperations).files;
      }
      const shouldStop = mode === "plan" || autonomy === "controlled" || finalReply.done || nextOperations.length === 0 || stagedOperations.length >= operationBudget;
      if (shouldStop) break;
    }
    const reply = finalReply || normalizeStructuredReply(rawReply, {});
    const operationCounts = summarizeOperations(stagedOperations);
    if (usedBrain) {
      await recordBrainUsage({
        actor: actorEmail,
        actor_email: actorEmail,
        actor_user_id: u?.user_id || null,
        org_id: actorOrg,
        ws_id: wsId,
        app: "SkyDex4.6",
        auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
        api_token_id: tokenPrincipal?.id || null,
        api_token_label: tokenPrincipal?.label || null,
        api_token_locked_email: tokenPrincipal?.locked_email || null,
        used_backup: usedBrain.route === "backup",
        brain_route: usedBrain.route,
        provider: usedBrain.provider,
        model: usedBrain.model,
        gateway_request_id: usedGatewayRequestId,
        backup_request_id: usedBackupRequestId,
        gateway_status: usedGatewayStatus,
        backup_status: usedBackupStatus,
        usage: usedUsage || { prompt_tokens: null, completion_tokens: null, total_tokens: null, exact: false, source: "estimated" },
        billing: usedBilling || {
          actor_email: actorEmail,
          actor_user_id: u?.user_id || null,
          auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
          api_token_id: tokenPrincipal?.id || null,
          api_token_label: tokenPrincipal?.label || null,
          api_token_locked_email: tokenPrincipal?.locked_email || null
        },
        success: true
      });
    }
    await audit(actorEmail, actorOrg, wsId, "skydex.agent.ok", {
      mode,
      autonomy,
      operations: stagedOperations.length,
      touched: touched.size,
      brain: usedBrain,
      usage: usedUsage,
      billing: usedBilling,
      operation_counts: operationCounts
    });
    return json(200, {
      ok: true,
      result: {
        reply: formatReply(reply),
        summary: reply.summary,
        operations: stagedOperations,
        touched: Array.from(touched),
        report: {
          mode,
          autonomy,
          smartContext,
          contextDepth,
          seededFiles,
          workspaceFiles: initialFiles.length,
          operationBudget,
          maxIterations,
          operationCounts,
          brain: usedBrain,
          usage: usedUsage,
          billing: usedBilling
        }
      }
    });
  } catch (error) {
    await audit(actorEmail, actorOrg, wsId, "skydex.agent.failed", {
      mode,
      autonomy,
      error: String(error?.message || error)
    });
    return json(500, { error: "Agent run failed." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=ai-agent.js.map
