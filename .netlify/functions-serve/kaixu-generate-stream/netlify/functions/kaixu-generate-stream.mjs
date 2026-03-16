
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/kaixu-generate-stream.ts
import crypto2 from "crypto";

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

// netlify/functions/_shared/api_tokens.ts
import crypto from "crypto";
function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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
  return crypto.timingSafeEqual(aa, bb);
}
function tokenHasScope(scopes, required) {
  const actual = Array.isArray(scopes) ? scopes : [];
  return actual.includes(required) || actual.includes("admin");
}

// netlify/functions/kaixu-generate-stream.ts
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
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
function shouldUseBackup(status) {
  if (status == null) return true;
  return status === 429 || status >= 500;
}
function estimateTokens(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}
function summarizeMessages(messages) {
  return messages.map((message) => `${String(message?.role || "user")}: ${String(message?.content || "")}`.trim()).filter(Boolean).join("\n\n");
}
function extractStreamEventText(dataChunk) {
  const trimmed = String(dataChunk || "").trim();
  if (!trimmed || trimmed === "[DONE]") return "";
  try {
    const parsed = JSON.parse(trimmed);
    return String(
      parsed?.text || parsed?.output || parsed?.delta?.content || parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || parsed?.candidates?.[0]?.content?.parts?.map((part) => String(part?.text || "")).join("") || ""
    ).trim();
  } catch {
    return trimmed;
  }
}
function createUsageFromStream(messages, outputText) {
  const promptTokens = estimateTokens(summarizeMessages(messages));
  const completionTokens = estimateTokens(outputText);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens == null && completionTokens == null ? null : (promptTokens || 0) + (completionTokens || 0),
    exact: false,
    source: "estimated"
  };
}
function sseHeaders(extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  return headers;
}
function buildRunnerHeaders(path, payload) {
  const secret = must("RUNNER_SHARED_SECRET");
  const ts = Date.now().toString();
  const body = JSON.stringify(payload ?? {});
  const canonical = `${ts}
${path}
${body}`;
  const sig = crypto2.createHmac("sha256", secret).update(canonical).digest("base64url");
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-KX-TS": ts,
    "X-KX-SIG": sig
  };
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  if (accessClientId && accessClientSecret) {
    headers["CF-Access-Client-Id"] = accessClientId;
    headers["CF-Access-Client-Secret"] = accessClientSecret;
  }
  return { headers, body };
}
function trackStreamAndLog({
  upstream,
  actor,
  actorEmail,
  actorUserId,
  actorOrg,
  wsId,
  authType,
  apiTokenId,
  apiTokenLabel,
  apiTokenLockedEmail,
  app,
  route,
  provider,
  model,
  gatewayStatus,
  backupStatus,
  gatewayRequestId,
  backupRequestId,
  messages
}) {
  if (!upstream.body) {
    return new Response(null, {
      status: upstream.status,
      headers: sseHeaders(upstream.headers)
    });
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  let streamedText = "";
  const body = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        const usage = createUsageFromStream(messages, streamedText);
        await recordBrainUsage({
          actor,
          actor_email: actorEmail,
          actor_user_id: actorUserId,
          org_id: actorOrg,
          ws_id: wsId,
          app,
          auth_type: authType,
          api_token_id: apiTokenId,
          api_token_label: apiTokenLabel,
          api_token_locked_email: apiTokenLockedEmail,
          used_backup: route === "backup",
          brain_route: route,
          provider,
          model,
          gateway_request_id: gatewayRequestId,
          backup_request_id: backupRequestId,
          gateway_status: gatewayStatus,
          backup_status: backupStatus,
          usage,
          billing: {
            actor_email: actorEmail,
            actor_user_id: actorUserId,
            auth_type: authType,
            api_token_id: apiTokenId,
            api_token_label: apiTokenLabel,
            api_token_locked_email: apiTokenLockedEmail
          },
          success: true
        });
        controller.close();
        return;
      }
      if (value) {
        const text = decoder.decode(value, { stream: true });
        sseBuffer += text;
        const frames = sseBuffer.split("\n\n");
        sseBuffer = frames.pop() || "";
        for (const frame of frames) {
          const dataLines = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
          for (const dataChunk of dataLines) streamedText += extractStreamEventText(dataChunk);
        }
        controller.enqueue(value);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });
  return new Response(body, {
    status: upstream.status,
    headers: sseHeaders(upstream.headers)
  });
}
var kaixu_generate_stream_default = async (request) => {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }
  const headerBag = Object.fromEntries(request.headers.entries());
  const eventLike = { headers: { cookie: request.headers.get("cookie") || "", ...headerBag } };
  const u = await requireUser(eventLike);
  const bearer = readBearerToken(headerBag);
  const tokenPrincipal = bearer ? await resolveApiToken(bearer) : null;
  if (!u && !tokenPrincipal) return jsonResponse(401, JSON.parse(String(forbid().body)));
  const tokenEmailHeader = String(headerBag["x-token-email"] || "").trim().toLowerCase();
  const tokenMasterHeader = String(headerBag["x-token-master-sequence"] || "").trim();
  const tokenMasterExpected = opt("TOKEN_MASTER_SEQUENCE", "");
  const tokenMasterBypass = hasValidMasterSequence(tokenMasterHeader, tokenMasterExpected);
  if (tokenPrincipal?.locked_email && !tokenMasterBypass) {
    if (!tokenEmailHeader || tokenEmailHeader !== tokenPrincipal.locked_email.toLowerCase()) {
      return jsonResponse(401, { error: "Token email lock mismatch." });
    }
  }
  if (tokenPrincipal && !tokenHasScope(tokenPrincipal.scopes, "generate")) {
    return jsonResponse(403, { error: "Token missing required scope: generate" });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }
  const actorEmail = u?.email || `token:${tokenPrincipal?.prefix || "unknown"}`;
  const actorOrg = u?.org_id || tokenPrincipal?.org_id || null;
  const actorUserId = u?.user_id || null;
  const authType = tokenPrincipal ? "api_token" : u ? "session" : "unknown";
  const wsId = String(body?.ws_id || "").trim();
  const activePath = String(body?.activePath || "").trim() || null;
  const prompt = String(body?.prompt || "").trim();
  const files = Array.isArray(body?.files) ? body.files : [];
  if (!wsId || !prompt) {
    return jsonResponse(400, { error: "Missing ws_id or prompt." });
  }
  const sknorePatterns = await loadSknorePolicy(actorOrg, wsId || null);
  if (activePath && isSknoreProtected(activePath, sknorePatterns)) {
    await audit(actorEmail, actorOrg, wsId, "sknore.blocked.active_path", {
      activePath,
      patterns_count: sknorePatterns.length
    });
    return jsonResponse(403, {
      error: `SKNore policy blocks active file: ${activePath}`,
      code: "SKNORE_BLOCKED_ACTIVE_PATH"
    });
  }
  const safeFiles = filterSknoreFiles(files, sknorePatterns);
  if (files.length !== safeFiles.length) {
    await audit(actorEmail, actorOrg, wsId, "sknore.blocked.files", {
      requested_files: files.length,
      allowed_files: safeFiles.length,
      patterns_count: sknorePatterns.length
    });
  }
  const provider = String(opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London") || "Skyes Over London").trim() || "Skyes Over London";
  const model = String(body?.model || opt("KAIXU_GATEWAY_MODEL", "kAIxU-Prime6.7") || "kAIxU-Prime6.7").trim() || "kAIxU-Prime6.7";
  const messages = [
    {
      role: "system",
      content: "You are kAIxU inside Super IDE. Enforce plan-first. Output concise steps and patches. Speak directly to the user."
    },
    {
      role: "user",
      content: `Active file: ${activePath || ""}

User prompt:
${prompt}

Workspace snapshot:
${JSON.stringify(safeFiles || []).slice(0, 12e4)}`
    }
  ];
  await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.requested", {
    activePath,
    filesLength: safeFiles.length
  });
  const endpoint = normalizeKaixuGatewayEndpoint(must("KAIXU_GATEWAY_ENDPOINT"));
  const token = must("KAIXU_APP_TOKEN");
  const payload = { provider, model, messages, stream: true };
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
    if (upstream.ok && contentType.includes("text/event-stream") && upstream.body) {
      const gatewayRequestId = String(upstream.headers.get("x-kaixu-request-id") || "").trim() || null;
      await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.ok", {
        activePath,
        filesLength: safeFiles.length,
        route: "primary",
        used_backup: false,
        gateway_request_id: gatewayRequestId
      });
      return trackStreamAndLog({
        upstream,
        actor: actorEmail,
        actorEmail,
        actorUserId,
        actorOrg,
        wsId,
        authType,
        apiTokenId: tokenPrincipal?.id || null,
        apiTokenLabel: tokenPrincipal?.label || null,
        apiTokenLockedEmail: tokenPrincipal?.locked_email || tokenEmailHeader || null,
        app: "SuperIDE-stream",
        route: "primary",
        provider,
        model,
        gatewayStatus: upstream.status,
        backupStatus: null,
        gatewayRequestId,
        backupRequestId: null,
        messages
      });
    }
    if (!shouldUseBackup(upstream.status)) {
      const detail = await upstream.text().catch(() => "");
      await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.unavailable", {
        activePath,
        filesLength: safeFiles.length,
        route: "primary",
        status: upstream.status,
        detail: detail.slice(0, 400)
      });
      return jsonResponse(409, { ok: false, stream_supported: false, error: `Streaming unavailable (${upstream.status}).` });
    }
  } catch {
  }
  try {
    const runnerBase = must("WORKER_RUNNER_URL").replace(/\/+$/g, "");
    const runnerPath = "/v1/brain/backup/generate-stream";
    const signed = buildRunnerHeaders(runnerPath, {
      provider,
      model,
      messages,
      request_context: {
        ws_id: wsId,
        activePath,
        app: "SuperIDE",
        actor_email: actorEmail,
        actor_org: actorOrg
      },
      brain_policy: {
        allow_backup: true,
        allow_user_direct: false
      }
    });
    const backup = await fetch(`${runnerBase}${runnerPath}`, {
      method: "POST",
      headers: signed.headers,
      body: signed.body
    });
    const contentType = String(backup.headers.get("content-type") || "").toLowerCase();
    if (backup.ok && contentType.includes("text/event-stream") && backup.body) {
      const backupRequestId = String(backup.headers.get("x-kaixu-request-id") || "").trim() || null;
      await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.ok", {
        activePath,
        filesLength: safeFiles.length,
        route: "backup",
        used_backup: true,
        backup_request_id: backupRequestId
      });
      return trackStreamAndLog({
        upstream: backup,
        actor: actorEmail,
        actorEmail,
        actorUserId,
        actorOrg,
        wsId,
        authType,
        apiTokenId: tokenPrincipal?.id || null,
        apiTokenLabel: tokenPrincipal?.label || null,
        apiTokenLockedEmail: tokenPrincipal?.locked_email || tokenEmailHeader || null,
        app: "SuperIDE-stream",
        route: "backup",
        provider,
        model,
        gatewayStatus: null,
        backupStatus: backup.status,
        gatewayRequestId: null,
        backupRequestId,
        messages
      });
    }
    const detail = await backup.text().catch(() => "");
    await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.unavailable", {
      activePath,
      filesLength: safeFiles.length,
      route: "backup",
      status: backup.status,
      detail: detail.slice(0, 400)
    });
    return jsonResponse(409, { ok: false, stream_supported: false, error: `Streaming unavailable (${backup.status}).` });
  } catch (error) {
    await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.failed", {
      activePath,
      filesLength: safeFiles.length,
      error: String(error?.message || error || "Stream request failed.").slice(0, 220)
    });
    return jsonResponse(502, { ok: false, error: "Streaming route failed." });
  }
};
export {
  kaixu_generate_stream_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMva2FpeHUtZ2VuZXJhdGUtc3RyZWFtLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvZW52LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvbmVvbi50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL3Jlc3BvbnNlLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvYXV0aC50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2F1ZGl0LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvYnJhaW5fdXNhZ2UudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9za25vcmUudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9hcGlfdG9rZW5zLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgY3J5cHRvIGZyb20gXCJjcnlwdG9cIjtcblxuaW1wb3J0IHsgcmVxdWlyZVVzZXIsIGZvcmJpZCB9IGZyb20gXCIuL19zaGFyZWQvYXV0aFwiO1xuaW1wb3J0IHsgb3B0LCBtdXN0IH0gZnJvbSBcIi4vX3NoYXJlZC9lbnZcIjtcbmltcG9ydCB7IGF1ZGl0IH0gZnJvbSBcIi4vX3NoYXJlZC9hdWRpdFwiO1xuaW1wb3J0IHsgcmVjb3JkQnJhaW5Vc2FnZSB9IGZyb20gXCIuL19zaGFyZWQvYnJhaW5fdXNhZ2VcIjtcbmltcG9ydCB7IGZpbHRlclNrbm9yZUZpbGVzLCBpc1Nrbm9yZVByb3RlY3RlZCwgbG9hZFNrbm9yZVBvbGljeSB9IGZyb20gXCIuL19zaGFyZWQvc2tub3JlXCI7XG5pbXBvcnQgeyBoYXNWYWxpZE1hc3RlclNlcXVlbmNlLCByZWFkQmVhcmVyVG9rZW4sIHJlc29sdmVBcGlUb2tlbiwgdG9rZW5IYXNTY29wZSB9IGZyb20gXCIuL19zaGFyZWQvYXBpX3Rva2Vuc1wiO1xuXG5mdW5jdGlvbiBqc29uUmVzcG9uc2Uoc3RhdHVzOiBudW1iZXIsIGJvZHk6IGFueSkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGJvZHkgPz8ge30pLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tc3RvcmVcIixcbiAgICB9LFxuICB9KTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplS2FpeHVHYXRld2F5RW5kcG9pbnQocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbmRwb2ludCA9IFN0cmluZyhyYXcgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIWVuZHBvaW50KSByZXR1cm4gZW5kcG9pbnQ7XG4gIGlmICgvXmh0dHBzOlxcL1xcL3NreWVzb2xcXC5uZXRsaWZ5XFwuYXBwXFwvPyQvaS50ZXN0KGVuZHBvaW50KSkge1xuICAgIHJldHVybiBcImh0dHBzOi8vc2t5ZXNvbC5uZXRsaWZ5LmFwcC8ubmV0bGlmeS9mdW5jdGlvbnMvZ2F0ZXdheS1jaGF0XCI7XG4gIH1cbiAgaWYgKC9eaHR0cHM6XFwvXFwvc2t5ZXNvbFxcLm5ldGxpZnlcXC5hcHBcXC9wbGF0Zm9ybXMtYXBwcy1pbmZyYXN0cnVjdHVyZVxcL2thaXh1Z2F0ZXdheTEzXFwvdjFcXC9nZW5lcmF0ZVxcLz8kL2kudGVzdChlbmRwb2ludCkpIHtcbiAgICByZXR1cm4gXCJodHRwczovL3NreWVzb2wubmV0bGlmeS5hcHAvLm5ldGxpZnkvZnVuY3Rpb25zL2dhdGV3YXktY2hhdFwiO1xuICB9XG4gIHJldHVybiBlbmRwb2ludDtcbn1cblxuZnVuY3Rpb24gc2hvdWxkVXNlQmFja3VwKHN0YXR1czogbnVtYmVyIHwgbnVsbCk6IGJvb2xlYW4ge1xuICBpZiAoc3RhdHVzID09IG51bGwpIHJldHVybiB0cnVlO1xuICByZXR1cm4gc3RhdHVzID09PSA0MjkgfHwgc3RhdHVzID49IDUwMDtcbn1cblxuZnVuY3Rpb24gZXN0aW1hdGVUb2tlbnModGV4dDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBTdHJpbmcodGV4dCB8fCBcIlwiKS5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKS50cmltKCk7XG4gIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIDA7XG4gIHJldHVybiBNYXRoLm1heCgxLCBNYXRoLmNlaWwobm9ybWFsaXplZC5sZW5ndGggLyA0KSk7XG59XG5cbmZ1bmN0aW9uIHN1bW1hcml6ZU1lc3NhZ2VzKG1lc3NhZ2VzOiBBcnJheTx7IHJvbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0+KTogc3RyaW5nIHtcbiAgcmV0dXJuIG1lc3NhZ2VzXG4gICAgLm1hcCgobWVzc2FnZSkgPT4gYCR7U3RyaW5nKG1lc3NhZ2U/LnJvbGUgfHwgXCJ1c2VyXCIpfTogJHtTdHJpbmcobWVzc2FnZT8uY29udGVudCB8fCBcIlwiKX1gLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RTdHJlYW1FdmVudFRleHQoZGF0YUNodW5rOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gU3RyaW5nKGRhdGFDaHVuayB8fCBcIlwiKS50cmltKCk7XG4gIGlmICghdHJpbW1lZCB8fCB0cmltbWVkID09PSBcIltET05FXVwiKSByZXR1cm4gXCJcIjtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHRyaW1tZWQpO1xuICAgIHJldHVybiBTdHJpbmcoXG4gICAgICBwYXJzZWQ/LnRleHQgfHxcbiAgICAgIHBhcnNlZD8ub3V0cHV0IHx8XG4gICAgICBwYXJzZWQ/LmRlbHRhPy5jb250ZW50IHx8XG4gICAgICBwYXJzZWQ/LmNob2ljZXM/LlswXT8uZGVsdGE/LmNvbnRlbnQgfHxcbiAgICAgIHBhcnNlZD8uY2hvaWNlcz8uWzBdPy5tZXNzYWdlPy5jb250ZW50IHx8XG4gICAgICBwYXJzZWQ/LmNhbmRpZGF0ZXM/LlswXT8uY29udGVudD8ucGFydHM/Lm1hcCgocGFydDogYW55KSA9PiBTdHJpbmcocGFydD8udGV4dCB8fCBcIlwiKSkuam9pbihcIlwiKSB8fFxuICAgICAgXCJcIlxuICAgICkudHJpbSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdHJpbW1lZDtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVVc2FnZUZyb21TdHJlYW0obWVzc2FnZXM6IEFycmF5PHsgcm9sZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfT4sIG91dHB1dFRleHQ6IHN0cmluZykge1xuICBjb25zdCBwcm9tcHRUb2tlbnMgPSBlc3RpbWF0ZVRva2VucyhzdW1tYXJpemVNZXNzYWdlcyhtZXNzYWdlcykpO1xuICBjb25zdCBjb21wbGV0aW9uVG9rZW5zID0gZXN0aW1hdGVUb2tlbnMob3V0cHV0VGV4dCk7XG4gIHJldHVybiB7XG4gICAgcHJvbXB0X3Rva2VuczogcHJvbXB0VG9rZW5zLFxuICAgIGNvbXBsZXRpb25fdG9rZW5zOiBjb21wbGV0aW9uVG9rZW5zLFxuICAgIHRvdGFsX3Rva2VuczpcbiAgICAgIHByb21wdFRva2VucyA9PSBudWxsICYmIGNvbXBsZXRpb25Ub2tlbnMgPT0gbnVsbFxuICAgICAgICA/IG51bGxcbiAgICAgICAgOiAocHJvbXB0VG9rZW5zIHx8IDApICsgKGNvbXBsZXRpb25Ub2tlbnMgfHwgMCksXG4gICAgZXhhY3Q6IGZhbHNlLFxuICAgIHNvdXJjZTogXCJlc3RpbWF0ZWRcIiBhcyBjb25zdCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3NlSGVhZGVycyhleHRyYUhlYWRlcnM6IEhlYWRlcnMgfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30pIHtcbiAgY29uc3QgaGVhZGVycyA9IG5ldyBIZWFkZXJzKGV4dHJhSGVhZGVycyBhcyBIZWFkZXJzSW5pdCk7XG4gIGhlYWRlcnMuc2V0KFwiQ29udGVudC1UeXBlXCIsIFwidGV4dC9ldmVudC1zdHJlYW07IGNoYXJzZXQ9dXRmLThcIik7XG4gIGhlYWRlcnMuc2V0KFwiQ2FjaGUtQ29udHJvbFwiLCBcIm5vLWNhY2hlLCBuby10cmFuc2Zvcm1cIik7XG4gIGhlYWRlcnMuc2V0KFwiQ29ubmVjdGlvblwiLCBcImtlZXAtYWxpdmVcIik7XG4gIGhlYWRlcnMuc2V0KFwiWC1BY2NlbC1CdWZmZXJpbmdcIiwgXCJub1wiKTtcbiAgcmV0dXJuIGhlYWRlcnM7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkUnVubmVySGVhZGVycyhwYXRoOiBzdHJpbmcsIHBheWxvYWQ6IGFueSkge1xuICBjb25zdCBzZWNyZXQgPSBtdXN0KFwiUlVOTkVSX1NIQVJFRF9TRUNSRVRcIik7XG4gIGNvbnN0IHRzID0gRGF0ZS5ub3coKS50b1N0cmluZygpO1xuICBjb25zdCBib2R5ID0gSlNPTi5zdHJpbmdpZnkocGF5bG9hZCA/PyB7fSk7XG4gIGNvbnN0IGNhbm9uaWNhbCA9IGAke3RzfVxcbiR7cGF0aH1cXG4ke2JvZHl9YDtcbiAgY29uc3Qgc2lnID0gY3J5cHRvLmNyZWF0ZUhtYWMoXCJzaGEyNTZcIiwgc2VjcmV0KS51cGRhdGUoY2Fub25pY2FsKS5kaWdlc3QoXCJiYXNlNjR1cmxcIik7XG4gIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgQWNjZXB0OiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgXCJYLUtYLVRTXCI6IHRzLFxuICAgIFwiWC1LWC1TSUdcIjogc2lnLFxuICB9O1xuICBjb25zdCBhY2Nlc3NDbGllbnRJZCA9IHByb2Nlc3MuZW52LkNGX0FDQ0VTU19DTElFTlRfSUQgfHwgXCJcIjtcbiAgY29uc3QgYWNjZXNzQ2xpZW50U2VjcmV0ID0gcHJvY2Vzcy5lbnYuQ0ZfQUNDRVNTX0NMSUVOVF9TRUNSRVQgfHwgXCJcIjtcbiAgaWYgKGFjY2Vzc0NsaWVudElkICYmIGFjY2Vzc0NsaWVudFNlY3JldCkge1xuICAgIGhlYWRlcnNbXCJDRi1BY2Nlc3MtQ2xpZW50LUlkXCJdID0gYWNjZXNzQ2xpZW50SWQ7XG4gICAgaGVhZGVyc1tcIkNGLUFjY2Vzcy1DbGllbnQtU2VjcmV0XCJdID0gYWNjZXNzQ2xpZW50U2VjcmV0O1xuICB9XG4gIHJldHVybiB7IGhlYWRlcnMsIGJvZHkgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3RyZWFtVGhyb3VnaCh1cHN0cmVhbTogUmVzcG9uc2UpIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZSh1cHN0cmVhbS5ib2R5LCB7XG4gICAgc3RhdHVzOiB1cHN0cmVhbS5zdGF0dXMsXG4gICAgaGVhZGVyczogc3NlSGVhZGVycyh1cHN0cmVhbS5oZWFkZXJzKSxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHRyYWNrU3RyZWFtQW5kTG9nKHtcbiAgdXBzdHJlYW0sXG4gIGFjdG9yLFxuICBhY3RvckVtYWlsLFxuICBhY3RvclVzZXJJZCxcbiAgYWN0b3JPcmcsXG4gIHdzSWQsXG4gIGF1dGhUeXBlLFxuICBhcGlUb2tlbklkLFxuICBhcGlUb2tlbkxhYmVsLFxuICBhcGlUb2tlbkxvY2tlZEVtYWlsLFxuICBhcHAsXG4gIHJvdXRlLFxuICBwcm92aWRlcixcbiAgbW9kZWwsXG4gIGdhdGV3YXlTdGF0dXMsXG4gIGJhY2t1cFN0YXR1cyxcbiAgZ2F0ZXdheVJlcXVlc3RJZCxcbiAgYmFja3VwUmVxdWVzdElkLFxuICBtZXNzYWdlcyxcbn06IHtcbiAgdXBzdHJlYW06IFJlc3BvbnNlO1xuICBhY3Rvcjogc3RyaW5nO1xuICBhY3RvckVtYWlsOiBzdHJpbmc7XG4gIGFjdG9yVXNlcklkOiBzdHJpbmcgfCBudWxsO1xuICBhY3Rvck9yZzogc3RyaW5nIHwgbnVsbDtcbiAgd3NJZDogc3RyaW5nO1xuICBhdXRoVHlwZTogXCJzZXNzaW9uXCIgfCBcImFwaV90b2tlblwiIHwgXCJ1bmtub3duXCI7XG4gIGFwaVRva2VuSWQ6IHN0cmluZyB8IG51bGw7XG4gIGFwaVRva2VuTGFiZWw6IHN0cmluZyB8IG51bGw7XG4gIGFwaVRva2VuTG9ja2VkRW1haWw6IHN0cmluZyB8IG51bGw7XG4gIGFwcDogc3RyaW5nO1xuICByb3V0ZTogXCJwcmltYXJ5XCIgfCBcImJhY2t1cFwiO1xuICBwcm92aWRlcjogc3RyaW5nO1xuICBtb2RlbDogc3RyaW5nO1xuICBnYXRld2F5U3RhdHVzOiBudW1iZXIgfCBudWxsO1xuICBiYWNrdXBTdGF0dXM6IG51bWJlciB8IG51bGw7XG4gIGdhdGV3YXlSZXF1ZXN0SWQ6IHN0cmluZyB8IG51bGw7XG4gIGJhY2t1cFJlcXVlc3RJZDogc3RyaW5nIHwgbnVsbDtcbiAgbWVzc2FnZXM6IEFycmF5PHsgcm9sZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfT47XG59KSB7XG4gIGlmICghdXBzdHJlYW0uYm9keSkge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UobnVsbCwge1xuICAgICAgc3RhdHVzOiB1cHN0cmVhbS5zdGF0dXMsXG4gICAgICBoZWFkZXJzOiBzc2VIZWFkZXJzKHVwc3RyZWFtLmhlYWRlcnMpLFxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgcmVhZGVyID0gdXBzdHJlYW0uYm9keS5nZXRSZWFkZXIoKTtcbiAgY29uc3QgZGVjb2RlciA9IG5ldyBUZXh0RGVjb2RlcigpO1xuICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKCk7XG4gIGxldCBzc2VCdWZmZXIgPSBcIlwiO1xuICBsZXQgc3RyZWFtZWRUZXh0ID0gXCJcIjtcblxuICBjb25zdCBib2R5ID0gbmV3IFJlYWRhYmxlU3RyZWFtPFVpbnQ4QXJyYXk+KHtcbiAgICBhc3luYyBwdWxsKGNvbnRyb2xsZXIpIHtcbiAgICAgIGNvbnN0IHsgZG9uZSwgdmFsdWUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgICBpZiAoZG9uZSkge1xuICAgICAgICBjb25zdCB1c2FnZSA9IGNyZWF0ZVVzYWdlRnJvbVN0cmVhbShtZXNzYWdlcywgc3RyZWFtZWRUZXh0KTtcbiAgICAgICAgYXdhaXQgcmVjb3JkQnJhaW5Vc2FnZSh7XG4gICAgICAgICAgYWN0b3IsXG4gICAgICAgICAgYWN0b3JfZW1haWw6IGFjdG9yRW1haWwsXG4gICAgICAgICAgYWN0b3JfdXNlcl9pZDogYWN0b3JVc2VySWQsXG4gICAgICAgICAgb3JnX2lkOiBhY3Rvck9yZyxcbiAgICAgICAgICB3c19pZDogd3NJZCxcbiAgICAgICAgICBhcHAsXG4gICAgICAgICAgYXV0aF90eXBlOiBhdXRoVHlwZSxcbiAgICAgICAgICBhcGlfdG9rZW5faWQ6IGFwaVRva2VuSWQsXG4gICAgICAgICAgYXBpX3Rva2VuX2xhYmVsOiBhcGlUb2tlbkxhYmVsLFxuICAgICAgICAgIGFwaV90b2tlbl9sb2NrZWRfZW1haWw6IGFwaVRva2VuTG9ja2VkRW1haWwsXG4gICAgICAgICAgdXNlZF9iYWNrdXA6IHJvdXRlID09PSBcImJhY2t1cFwiLFxuICAgICAgICAgIGJyYWluX3JvdXRlOiByb3V0ZSxcbiAgICAgICAgICBwcm92aWRlcixcbiAgICAgICAgICBtb2RlbCxcbiAgICAgICAgICBnYXRld2F5X3JlcXVlc3RfaWQ6IGdhdGV3YXlSZXF1ZXN0SWQsXG4gICAgICAgICAgYmFja3VwX3JlcXVlc3RfaWQ6IGJhY2t1cFJlcXVlc3RJZCxcbiAgICAgICAgICBnYXRld2F5X3N0YXR1czogZ2F0ZXdheVN0YXR1cyxcbiAgICAgICAgICBiYWNrdXBfc3RhdHVzOiBiYWNrdXBTdGF0dXMsXG4gICAgICAgICAgdXNhZ2UsXG4gICAgICAgICAgYmlsbGluZzoge1xuICAgICAgICAgICAgYWN0b3JfZW1haWw6IGFjdG9yRW1haWwsXG4gICAgICAgICAgICBhY3Rvcl91c2VyX2lkOiBhY3RvclVzZXJJZCxcbiAgICAgICAgICAgIGF1dGhfdHlwZTogYXV0aFR5cGUsXG4gICAgICAgICAgICBhcGlfdG9rZW5faWQ6IGFwaVRva2VuSWQsXG4gICAgICAgICAgICBhcGlfdG9rZW5fbGFiZWw6IGFwaVRva2VuTGFiZWwsXG4gICAgICAgICAgICBhcGlfdG9rZW5fbG9ja2VkX2VtYWlsOiBhcGlUb2tlbkxvY2tlZEVtYWlsLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRyb2xsZXIuY2xvc2UoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgY29uc3QgdGV4dCA9IGRlY29kZXIuZGVjb2RlKHZhbHVlLCB7IHN0cmVhbTogdHJ1ZSB9KTtcbiAgICAgICAgc3NlQnVmZmVyICs9IHRleHQ7XG4gICAgICAgIGNvbnN0IGZyYW1lcyA9IHNzZUJ1ZmZlci5zcGxpdChcIlxcblxcblwiKTtcbiAgICAgICAgc3NlQnVmZmVyID0gZnJhbWVzLnBvcCgpIHx8IFwiXCI7XG4gICAgICAgIGZvciAoY29uc3QgZnJhbWUgb2YgZnJhbWVzKSB7XG4gICAgICAgICAgY29uc3QgZGF0YUxpbmVzID0gZnJhbWVcbiAgICAgICAgICAgIC5zcGxpdChcIlxcblwiKVxuICAgICAgICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKFwiZGF0YTpcIikpXG4gICAgICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnNsaWNlKDUpLnRyaW0oKSlcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgICAgZm9yIChjb25zdCBkYXRhQ2h1bmsgb2YgZGF0YUxpbmVzKSBzdHJlYW1lZFRleHQgKz0gZXh0cmFjdFN0cmVhbUV2ZW50VGV4dChkYXRhQ2h1bmspO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZSh2YWx1ZSk7XG4gICAgICB9XG4gICAgfSxcbiAgICBhc3luYyBjYW5jZWwocmVhc29uKSB7XG4gICAgICBhd2FpdCByZWFkZXIuY2FuY2VsKHJlYXNvbik7XG4gICAgfSxcbiAgfSk7XG5cbiAgcmV0dXJuIG5ldyBSZXNwb25zZShib2R5LCB7XG4gICAgc3RhdHVzOiB1cHN0cmVhbS5zdGF0dXMsXG4gICAgaGVhZGVyczogc3NlSGVhZGVycyh1cHN0cmVhbS5oZWFkZXJzKSxcbiAgfSk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIChyZXF1ZXN0OiBSZXF1ZXN0KSA9PiB7XG4gIGlmIChyZXF1ZXN0Lm1ldGhvZC50b1VwcGVyQ2FzZSgpICE9PSBcIlBPU1RcIikge1xuICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDA1LCB7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZC5cIiB9KTtcbiAgfVxuXG4gIGNvbnN0IGhlYWRlckJhZyA9IE9iamVjdC5mcm9tRW50cmllcyhyZXF1ZXN0LmhlYWRlcnMuZW50cmllcygpKTtcbiAgY29uc3QgZXZlbnRMaWtlID0geyBoZWFkZXJzOiB7IGNvb2tpZTogcmVxdWVzdC5oZWFkZXJzLmdldChcImNvb2tpZVwiKSB8fCBcIlwiLCAuLi5oZWFkZXJCYWcgfSB9O1xuICBjb25zdCB1ID0gYXdhaXQgcmVxdWlyZVVzZXIoZXZlbnRMaWtlIGFzIGFueSk7XG4gIGNvbnN0IGJlYXJlciA9IHJlYWRCZWFyZXJUb2tlbihoZWFkZXJCYWcpO1xuICBjb25zdCB0b2tlblByaW5jaXBhbCA9IGJlYXJlciA/IGF3YWl0IHJlc29sdmVBcGlUb2tlbihiZWFyZXIpIDogbnVsbDtcbiAgaWYgKCF1ICYmICF0b2tlblByaW5jaXBhbCkgcmV0dXJuIGpzb25SZXNwb25zZSg0MDEsIEpTT04ucGFyc2UoU3RyaW5nKGZvcmJpZCgpLmJvZHkpKSk7XG5cbiAgY29uc3QgdG9rZW5FbWFpbEhlYWRlciA9IFN0cmluZyhoZWFkZXJCYWdbXCJ4LXRva2VuLWVtYWlsXCJdIHx8IFwiXCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCB0b2tlbk1hc3RlckhlYWRlciA9IFN0cmluZyhoZWFkZXJCYWdbXCJ4LXRva2VuLW1hc3Rlci1zZXF1ZW5jZVwiXSB8fCBcIlwiKS50cmltKCk7XG4gIGNvbnN0IHRva2VuTWFzdGVyRXhwZWN0ZWQgPSBvcHQoXCJUT0tFTl9NQVNURVJfU0VRVUVOQ0VcIiwgXCJcIik7XG4gIGNvbnN0IHRva2VuTWFzdGVyQnlwYXNzID0gaGFzVmFsaWRNYXN0ZXJTZXF1ZW5jZSh0b2tlbk1hc3RlckhlYWRlciwgdG9rZW5NYXN0ZXJFeHBlY3RlZCk7XG5cbiAgaWYgKHRva2VuUHJpbmNpcGFsPy5sb2NrZWRfZW1haWwgJiYgIXRva2VuTWFzdGVyQnlwYXNzKSB7XG4gICAgaWYgKCF0b2tlbkVtYWlsSGVhZGVyIHx8IHRva2VuRW1haWxIZWFkZXIgIT09IHRva2VuUHJpbmNpcGFsLmxvY2tlZF9lbWFpbC50b0xvd2VyQ2FzZSgpKSB7XG4gICAgICByZXR1cm4ganNvblJlc3BvbnNlKDQwMSwgeyBlcnJvcjogXCJUb2tlbiBlbWFpbCBsb2NrIG1pc21hdGNoLlwiIH0pO1xuICAgIH1cbiAgfVxuXG4gIGlmICh0b2tlblByaW5jaXBhbCAmJiAhdG9rZW5IYXNTY29wZSh0b2tlblByaW5jaXBhbC5zY29wZXMsIFwiZ2VuZXJhdGVcIikpIHtcbiAgICByZXR1cm4ganNvblJlc3BvbnNlKDQwMywgeyBlcnJvcjogXCJUb2tlbiBtaXNzaW5nIHJlcXVpcmVkIHNjb3BlOiBnZW5lcmF0ZVwiIH0pO1xuICB9XG5cbiAgbGV0IGJvZHk6IGFueSA9IHt9O1xuICB0cnkge1xuICAgIGJvZHkgPSBhd2FpdCByZXF1ZXN0Lmpzb24oKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSg0MDAsIHsgZXJyb3I6IFwiSW52YWxpZCBKU09OIGJvZHkuXCIgfSk7XG4gIH1cblxuICBjb25zdCBhY3RvckVtYWlsID0gdT8uZW1haWwgfHwgYHRva2VuOiR7dG9rZW5QcmluY2lwYWw/LnByZWZpeCB8fCBcInVua25vd25cIn1gO1xuICBjb25zdCBhY3Rvck9yZyA9IHU/Lm9yZ19pZCB8fCB0b2tlblByaW5jaXBhbD8ub3JnX2lkIHx8IG51bGw7XG4gIGNvbnN0IGFjdG9yVXNlcklkID0gdT8udXNlcl9pZCB8fCBudWxsO1xuICBjb25zdCBhdXRoVHlwZSA9IHRva2VuUHJpbmNpcGFsID8gXCJhcGlfdG9rZW5cIiA6IHUgPyBcInNlc3Npb25cIiA6IFwidW5rbm93blwiO1xuICBjb25zdCB3c0lkID0gU3RyaW5nKGJvZHk/LndzX2lkIHx8IFwiXCIpLnRyaW0oKTtcbiAgY29uc3QgYWN0aXZlUGF0aCA9IFN0cmluZyhib2R5Py5hY3RpdmVQYXRoIHx8IFwiXCIpLnRyaW0oKSB8fCBudWxsO1xuICBjb25zdCBwcm9tcHQgPSBTdHJpbmcoYm9keT8ucHJvbXB0IHx8IFwiXCIpLnRyaW0oKTtcbiAgY29uc3QgZmlsZXMgPSBBcnJheS5pc0FycmF5KGJvZHk/LmZpbGVzKSA/IGJvZHkuZmlsZXMgOiBbXTtcbiAgaWYgKCF3c0lkIHx8ICFwcm9tcHQpIHtcbiAgICByZXR1cm4ganNvblJlc3BvbnNlKDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHdzX2lkIG9yIHByb21wdC5cIiB9KTtcbiAgfVxuXG4gIGNvbnN0IHNrbm9yZVBhdHRlcm5zID0gYXdhaXQgbG9hZFNrbm9yZVBvbGljeShhY3Rvck9yZyBhcyBzdHJpbmcsIHdzSWQgfHwgbnVsbCk7XG4gIGlmIChhY3RpdmVQYXRoICYmIGlzU2tub3JlUHJvdGVjdGVkKGFjdGl2ZVBhdGgsIHNrbm9yZVBhdHRlcm5zKSkge1xuICAgIGF3YWl0IGF1ZGl0KGFjdG9yRW1haWwsIGFjdG9yT3JnLCB3c0lkLCBcInNrbm9yZS5ibG9ja2VkLmFjdGl2ZV9wYXRoXCIsIHtcbiAgICAgIGFjdGl2ZVBhdGgsXG4gICAgICBwYXR0ZXJuc19jb3VudDogc2tub3JlUGF0dGVybnMubGVuZ3RoLFxuICAgIH0pO1xuICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDAzLCB7XG4gICAgICBlcnJvcjogYFNLTm9yZSBwb2xpY3kgYmxvY2tzIGFjdGl2ZSBmaWxlOiAke2FjdGl2ZVBhdGh9YCxcbiAgICAgIGNvZGU6IFwiU0tOT1JFX0JMT0NLRURfQUNUSVZFX1BBVEhcIixcbiAgICB9KTtcbiAgfVxuXG4gIGNvbnN0IHNhZmVGaWxlcyA9IGZpbHRlclNrbm9yZUZpbGVzKGZpbGVzIGFzIEFycmF5PHsgcGF0aDogc3RyaW5nIH0+LCBza25vcmVQYXR0ZXJucyk7XG4gIGlmIChmaWxlcy5sZW5ndGggIT09IHNhZmVGaWxlcy5sZW5ndGgpIHtcbiAgICBhd2FpdCBhdWRpdChhY3RvckVtYWlsLCBhY3Rvck9yZywgd3NJZCwgXCJza25vcmUuYmxvY2tlZC5maWxlc1wiLCB7XG4gICAgICByZXF1ZXN0ZWRfZmlsZXM6IGZpbGVzLmxlbmd0aCxcbiAgICAgIGFsbG93ZWRfZmlsZXM6IHNhZmVGaWxlcy5sZW5ndGgsXG4gICAgICBwYXR0ZXJuc19jb3VudDogc2tub3JlUGF0dGVybnMubGVuZ3RoLFxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgcHJvdmlkZXIgPSBTdHJpbmcob3B0KFwiS0FJWFVfR0FURVdBWV9QUk9WSURFUlwiLCBcIlNreWVzIE92ZXIgTG9uZG9uXCIpIHx8IFwiU2t5ZXMgT3ZlciBMb25kb25cIikudHJpbSgpIHx8IFwiU2t5ZXMgT3ZlciBMb25kb25cIjtcbiAgY29uc3QgbW9kZWwgPSBTdHJpbmcoYm9keT8ubW9kZWwgfHwgb3B0KFwiS0FJWFVfR0FURVdBWV9NT0RFTFwiLCBcImtBSXhVLVByaW1lNi43XCIpIHx8IFwia0FJeFUtUHJpbWU2LjdcIikudHJpbSgpIHx8IFwia0FJeFUtUHJpbWU2LjdcIjtcbiAgY29uc3QgbWVzc2FnZXMgPSBbXG4gICAge1xuICAgICAgcm9sZTogXCJzeXN0ZW1cIixcbiAgICAgIGNvbnRlbnQ6IFwiWW91IGFyZSBrQUl4VSBpbnNpZGUgU3VwZXIgSURFLiBFbmZvcmNlIHBsYW4tZmlyc3QuIE91dHB1dCBjb25jaXNlIHN0ZXBzIGFuZCBwYXRjaGVzLiBTcGVhayBkaXJlY3RseSB0byB0aGUgdXNlci5cIixcbiAgICB9LFxuICAgIHtcbiAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgY29udGVudDogYEFjdGl2ZSBmaWxlOiAke2FjdGl2ZVBhdGggfHwgXCJcIn1cXG5cXG5Vc2VyIHByb21wdDpcXG4ke3Byb21wdH1cXG5cXG5Xb3Jrc3BhY2Ugc25hcHNob3Q6XFxuJHtKU09OLnN0cmluZ2lmeShzYWZlRmlsZXMgfHwgW10pLnNsaWNlKDAsIDEyMDAwMCl9YCxcbiAgICB9LFxuICBdO1xuXG4gIGF3YWl0IGF1ZGl0KGFjdG9yRW1haWwsIGFjdG9yT3JnLCB3c0lkLCBcImthaXh1LmdlbmVyYXRlLnN0cmVhbS5yZXF1ZXN0ZWRcIiwge1xuICAgIGFjdGl2ZVBhdGgsXG4gICAgZmlsZXNMZW5ndGg6IHNhZmVGaWxlcy5sZW5ndGgsXG4gIH0pO1xuXG4gIGNvbnN0IGVuZHBvaW50ID0gbm9ybWFsaXplS2FpeHVHYXRld2F5RW5kcG9pbnQobXVzdChcIktBSVhVX0dBVEVXQVlfRU5EUE9JTlRcIikpO1xuICBjb25zdCB0b2tlbiA9IG11c3QoXCJLQUlYVV9BUFBfVE9LRU5cIik7XG4gIGNvbnN0IHBheWxvYWQgPSB7IHByb3ZpZGVyLCBtb2RlbCwgbWVzc2FnZXMsIHN0cmVhbTogdHJ1ZSB9O1xuXG4gIHRyeSB7XG4gICAgY29uc3QgdXBzdHJlYW0gPSBhd2FpdCBmZXRjaChlbmRwb2ludCwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIEFjY2VwdDogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dG9rZW59YCxcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gU3RyaW5nKHVwc3RyZWFtLmhlYWRlcnMuZ2V0KFwiY29udGVudC10eXBlXCIpIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKHVwc3RyZWFtLm9rICYmIGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwidGV4dC9ldmVudC1zdHJlYW1cIikgJiYgdXBzdHJlYW0uYm9keSkge1xuICAgICAgY29uc3QgZ2F0ZXdheVJlcXVlc3RJZCA9IFN0cmluZyh1cHN0cmVhbS5oZWFkZXJzLmdldChcIngta2FpeHUtcmVxdWVzdC1pZFwiKSB8fCBcIlwiKS50cmltKCkgfHwgbnVsbDtcbiAgICAgIGF3YWl0IGF1ZGl0KGFjdG9yRW1haWwsIGFjdG9yT3JnLCB3c0lkLCBcImthaXh1LmdlbmVyYXRlLnN0cmVhbS5va1wiLCB7XG4gICAgICAgIGFjdGl2ZVBhdGgsXG4gICAgICAgIGZpbGVzTGVuZ3RoOiBzYWZlRmlsZXMubGVuZ3RoLFxuICAgICAgICByb3V0ZTogXCJwcmltYXJ5XCIsXG4gICAgICAgIHVzZWRfYmFja3VwOiBmYWxzZSxcbiAgICAgICAgZ2F0ZXdheV9yZXF1ZXN0X2lkOiBnYXRld2F5UmVxdWVzdElkLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gdHJhY2tTdHJlYW1BbmRMb2coe1xuICAgICAgICB1cHN0cmVhbSxcbiAgICAgICAgYWN0b3I6IGFjdG9yRW1haWwsXG4gICAgICAgIGFjdG9yRW1haWwsXG4gICAgICAgIGFjdG9yVXNlcklkLFxuICAgICAgICBhY3Rvck9yZyxcbiAgICAgICAgd3NJZCxcbiAgICAgICAgYXV0aFR5cGUsXG4gICAgICAgIGFwaVRva2VuSWQ6IHRva2VuUHJpbmNpcGFsPy5pZCB8fCBudWxsLFxuICAgICAgICBhcGlUb2tlbkxhYmVsOiB0b2tlblByaW5jaXBhbD8ubGFiZWwgfHwgbnVsbCxcbiAgICAgICAgYXBpVG9rZW5Mb2NrZWRFbWFpbDogdG9rZW5QcmluY2lwYWw/LmxvY2tlZF9lbWFpbCB8fCB0b2tlbkVtYWlsSGVhZGVyIHx8IG51bGwsXG4gICAgICAgIGFwcDogXCJTdXBlcklERS1zdHJlYW1cIixcbiAgICAgICAgcm91dGU6IFwicHJpbWFyeVwiLFxuICAgICAgICBwcm92aWRlcixcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIGdhdGV3YXlTdGF0dXM6IHVwc3RyZWFtLnN0YXR1cyxcbiAgICAgICAgYmFja3VwU3RhdHVzOiBudWxsLFxuICAgICAgICBnYXRld2F5UmVxdWVzdElkLFxuICAgICAgICBiYWNrdXBSZXF1ZXN0SWQ6IG51bGwsXG4gICAgICAgIG1lc3NhZ2VzLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCFzaG91bGRVc2VCYWNrdXAodXBzdHJlYW0uc3RhdHVzKSkge1xuICAgICAgY29uc3QgZGV0YWlsID0gYXdhaXQgdXBzdHJlYW0udGV4dCgpLmNhdGNoKCgpID0+IFwiXCIpO1xuICAgICAgYXdhaXQgYXVkaXQoYWN0b3JFbWFpbCwgYWN0b3JPcmcsIHdzSWQsIFwia2FpeHUuZ2VuZXJhdGUuc3RyZWFtLnVuYXZhaWxhYmxlXCIsIHtcbiAgICAgICAgYWN0aXZlUGF0aCxcbiAgICAgICAgZmlsZXNMZW5ndGg6IHNhZmVGaWxlcy5sZW5ndGgsXG4gICAgICAgIHJvdXRlOiBcInByaW1hcnlcIixcbiAgICAgICAgc3RhdHVzOiB1cHN0cmVhbS5zdGF0dXMsXG4gICAgICAgIGRldGFpbDogZGV0YWlsLnNsaWNlKDAsIDQwMCksXG4gICAgICB9KTtcbiAgICAgIHJldHVybiBqc29uUmVzcG9uc2UoNDA5LCB7IG9rOiBmYWxzZSwgc3RyZWFtX3N1cHBvcnRlZDogZmFsc2UsIGVycm9yOiBgU3RyZWFtaW5nIHVuYXZhaWxhYmxlICgke3Vwc3RyZWFtLnN0YXR1c30pLmAgfSk7XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBmYWxsIHRocm91Z2ggdG8gYmFja3VwIHBhdGhcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgcnVubmVyQmFzZSA9IG11c3QoXCJXT1JLRVJfUlVOTkVSX1VSTFwiKS5yZXBsYWNlKC9cXC8rJC9nLCBcIlwiKTtcbiAgICBjb25zdCBydW5uZXJQYXRoID0gXCIvdjEvYnJhaW4vYmFja3VwL2dlbmVyYXRlLXN0cmVhbVwiO1xuICAgIGNvbnN0IHNpZ25lZCA9IGJ1aWxkUnVubmVySGVhZGVycyhydW5uZXJQYXRoLCB7XG4gICAgICBwcm92aWRlcixcbiAgICAgIG1vZGVsLFxuICAgICAgbWVzc2FnZXMsXG4gICAgICByZXF1ZXN0X2NvbnRleHQ6IHtcbiAgICAgICAgd3NfaWQ6IHdzSWQsXG4gICAgICAgIGFjdGl2ZVBhdGgsXG4gICAgICAgIGFwcDogXCJTdXBlcklERVwiLFxuICAgICAgICBhY3Rvcl9lbWFpbDogYWN0b3JFbWFpbCxcbiAgICAgICAgYWN0b3Jfb3JnOiBhY3Rvck9yZyxcbiAgICAgIH0sXG4gICAgICBicmFpbl9wb2xpY3k6IHtcbiAgICAgICAgYWxsb3dfYmFja3VwOiB0cnVlLFxuICAgICAgICBhbGxvd191c2VyX2RpcmVjdDogZmFsc2UsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGNvbnN0IGJhY2t1cCA9IGF3YWl0IGZldGNoKGAke3J1bm5lckJhc2V9JHtydW5uZXJQYXRofWAsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBoZWFkZXJzOiBzaWduZWQuaGVhZGVycyxcbiAgICAgIGJvZHk6IHNpZ25lZC5ib2R5LFxuICAgIH0pO1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gU3RyaW5nKGJhY2t1cC5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKSB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChiYWNrdXAub2sgJiYgY29udGVudFR5cGUuaW5jbHVkZXMoXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiKSAmJiBiYWNrdXAuYm9keSkge1xuICAgICAgY29uc3QgYmFja3VwUmVxdWVzdElkID0gU3RyaW5nKGJhY2t1cC5oZWFkZXJzLmdldChcIngta2FpeHUtcmVxdWVzdC1pZFwiKSB8fCBcIlwiKS50cmltKCkgfHwgbnVsbDtcbiAgICAgIGF3YWl0IGF1ZGl0KGFjdG9yRW1haWwsIGFjdG9yT3JnLCB3c0lkLCBcImthaXh1LmdlbmVyYXRlLnN0cmVhbS5va1wiLCB7XG4gICAgICAgIGFjdGl2ZVBhdGgsXG4gICAgICAgIGZpbGVzTGVuZ3RoOiBzYWZlRmlsZXMubGVuZ3RoLFxuICAgICAgICByb3V0ZTogXCJiYWNrdXBcIixcbiAgICAgICAgdXNlZF9iYWNrdXA6IHRydWUsXG4gICAgICAgIGJhY2t1cF9yZXF1ZXN0X2lkOiBiYWNrdXBSZXF1ZXN0SWQsXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB0cmFja1N0cmVhbUFuZExvZyh7XG4gICAgICAgIHVwc3RyZWFtOiBiYWNrdXAsXG4gICAgICAgIGFjdG9yOiBhY3RvckVtYWlsLFxuICAgICAgICBhY3RvckVtYWlsLFxuICAgICAgICBhY3RvclVzZXJJZCxcbiAgICAgICAgYWN0b3JPcmcsXG4gICAgICAgIHdzSWQsXG4gICAgICAgIGF1dGhUeXBlLFxuICAgICAgICBhcGlUb2tlbklkOiB0b2tlblByaW5jaXBhbD8uaWQgfHwgbnVsbCxcbiAgICAgICAgYXBpVG9rZW5MYWJlbDogdG9rZW5QcmluY2lwYWw/LmxhYmVsIHx8IG51bGwsXG4gICAgICAgIGFwaVRva2VuTG9ja2VkRW1haWw6IHRva2VuUHJpbmNpcGFsPy5sb2NrZWRfZW1haWwgfHwgdG9rZW5FbWFpbEhlYWRlciB8fCBudWxsLFxuICAgICAgICBhcHA6IFwiU3VwZXJJREUtc3RyZWFtXCIsXG4gICAgICAgIHJvdXRlOiBcImJhY2t1cFwiLFxuICAgICAgICBwcm92aWRlcixcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIGdhdGV3YXlTdGF0dXM6IG51bGwsXG4gICAgICAgIGJhY2t1cFN0YXR1czogYmFja3VwLnN0YXR1cyxcbiAgICAgICAgZ2F0ZXdheVJlcXVlc3RJZDogbnVsbCxcbiAgICAgICAgYmFja3VwUmVxdWVzdElkLFxuICAgICAgICBtZXNzYWdlcyxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBkZXRhaWwgPSBhd2FpdCBiYWNrdXAudGV4dCgpLmNhdGNoKCgpID0+IFwiXCIpO1xuICAgIGF3YWl0IGF1ZGl0KGFjdG9yRW1haWwsIGFjdG9yT3JnLCB3c0lkLCBcImthaXh1LmdlbmVyYXRlLnN0cmVhbS51bmF2YWlsYWJsZVwiLCB7XG4gICAgICBhY3RpdmVQYXRoLFxuICAgICAgZmlsZXNMZW5ndGg6IHNhZmVGaWxlcy5sZW5ndGgsXG4gICAgICByb3V0ZTogXCJiYWNrdXBcIixcbiAgICAgIHN0YXR1czogYmFja3VwLnN0YXR1cyxcbiAgICAgIGRldGFpbDogZGV0YWlsLnNsaWNlKDAsIDQwMCksXG4gICAgfSk7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSg0MDksIHsgb2s6IGZhbHNlLCBzdHJlYW1fc3VwcG9ydGVkOiBmYWxzZSwgZXJyb3I6IGBTdHJlYW1pbmcgdW5hdmFpbGFibGUgKCR7YmFja3VwLnN0YXR1c30pLmAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBhd2FpdCBhdWRpdChhY3RvckVtYWlsLCBhY3Rvck9yZywgd3NJZCwgXCJrYWl4dS5nZW5lcmF0ZS5zdHJlYW0uZmFpbGVkXCIsIHtcbiAgICAgIGFjdGl2ZVBhdGgsXG4gICAgICBmaWxlc0xlbmd0aDogc2FmZUZpbGVzLmxlbmd0aCxcbiAgICAgIGVycm9yOiBTdHJpbmcoZXJyb3I/Lm1lc3NhZ2UgfHwgZXJyb3IgfHwgXCJTdHJlYW0gcmVxdWVzdCBmYWlsZWQuXCIpLnNsaWNlKDAsIDIyMCksXG4gICAgfSk7XG4gICAgcmV0dXJuIGpzb25SZXNwb25zZSg1MDIsIHsgb2s6IGZhbHNlLCBlcnJvcjogXCJTdHJlYW1pbmcgcm91dGUgZmFpbGVkLlwiIH0pO1xuICB9XG59OyIsICIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIGhlbHBlcnMgZm9yIE5ldGxpZnkgZnVuY3Rpb25zLiAgVXNlIG11c3QoKVxuICogd2hlbiBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZDsgaXQgdGhyb3dzIGFuIGVycm9yXG4gKiBpbnN0ZWFkIG9mIHJldHVybmluZyB1bmRlZmluZWQuICBVc2Ugb3B0KCkgZm9yIG9wdGlvbmFsIHZhbHVlc1xuICogd2l0aCBhbiBvcHRpb25hbCBmYWxsYmFjay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG11c3QobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdiA9IHByb2Nlc3MuZW52W25hbWVdO1xuICBpZiAoIXYpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBlbnYgdmFyOiAke25hbWV9YCk7XG4gIHJldHVybiB2O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gb3B0KG5hbWU6IHN0cmluZywgZmFsbGJhY2sgPSBcIlwiKTogc3RyaW5nIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52W25hbWVdIHx8IGZhbGxiYWNrO1xufSIsICJpbXBvcnQgeyBtdXN0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmZ1bmN0aW9uIHRvSHR0cFNxbEVuZHBvaW50KHVybDogc3RyaW5nKTogeyBlbmRwb2ludDogc3RyaW5nOyBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0ge1xuICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50OiB1cmwsXG4gICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmICgvXnBvc3RncmVzKHFsKT86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTCh1cmwpO1xuICAgIGNvbnN0IGVuZHBvaW50ID0gYGh0dHBzOi8vJHtwYXJzZWQuaG9zdH0vc3FsYDtcbiAgICByZXR1cm4ge1xuICAgICAgZW5kcG9pbnQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIk5lb24tQ29ubmVjdGlvbi1TdHJpbmdcIjogdXJsLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiTkVPTl9EQVRBQkFTRV9VUkwgbXVzdCBiZSBhbiBodHRwcyBTUUwgZW5kcG9pbnQgb3IgcG9zdGdyZXMgY29ubmVjdGlvbiBzdHJpbmcuXCIpO1xufVxuXG4vKipcbiAqIEV4ZWN1dGUgYSBTUUwgcXVlcnkgYWdhaW5zdCB0aGUgTmVvbiBzZXJ2ZXJsZXNzIGRhdGFiYXNlIHZpYSB0aGVcbiAqIEhUVFAgZW5kcG9pbnQuICBUaGUgTkVPTl9EQVRBQkFTRV9VUkwgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdFxuICogYmUgc2V0IHRvIGEgdmFsaWQgTmVvbiBTUUwtb3Zlci1IVFRQIGVuZHBvaW50LiAgUmV0dXJucyB0aGVcbiAqIHBhcnNlZCBKU09OIHJlc3VsdCB3aGljaCBpbmNsdWRlcyBhICdyb3dzJyBhcnJheS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHEoc3FsOiBzdHJpbmcsIHBhcmFtczogYW55W10gPSBbXSkge1xuICBjb25zdCB1cmwgPSBtdXN0KFwiTkVPTl9EQVRBQkFTRV9VUkxcIik7XG4gIGNvbnN0IHRhcmdldCA9IHRvSHR0cFNxbEVuZHBvaW50KHVybCk7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRhcmdldC5lbmRwb2ludCwge1xuICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgaGVhZGVyczogdGFyZ2V0LmhlYWRlcnMsXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogc3FsLCBwYXJhbXMgfSksXG4gIH0pO1xuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICAgIHRocm93IG5ldyBFcnJvcihgREIgZXJyb3I6ICR7dGV4dH1gKTtcbiAgfVxuICByZXR1cm4gcmVzLmpzb24oKSBhcyBQcm9taXNlPHsgcm93czogYW55W10gfT47XG59IiwgIi8qKlxuICogSGVscGVyIHRvIGJ1aWxkIEpTT04gcmVzcG9uc2VzIGZyb20gTmV0bGlmeSBmdW5jdGlvbnMuICBBdHRhY2hlc1xuICogc3RhbmRhcmQgaGVhZGVycyBhbmQgc3RyaW5naWZpZXMgdGhlIGJvZHkuICBBZGRpdGlvbmFsIGhlYWRlcnNcbiAqIGNhbiBiZSBwcm92aWRlZCB2aWEgdGhlIHRoaXJkIGFyZ3VtZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24ganNvbihcbiAgc3RhdHVzQ29kZTogbnVtYmVyLFxuICBib2R5OiBhbnksXG4gIGV4dHJhSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4pIHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXNDb2RlLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgLi4uZXh0cmFIZWFkZXJzLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSA/PyB7fSksXG4gIH07XG59IiwgImltcG9ydCB7IHEgfSBmcm9tIFwiLi9uZW9uXCI7XG5pbXBvcnQgeyBqc29uIH0gZnJvbSBcIi4vcmVzcG9uc2VcIjtcbmltcG9ydCB7IG9wdCB9IGZyb20gXCIuL2VudlwiO1xuXG5jb25zdCBDT09LSUUgPSBcImt4X3Nlc3Npb25cIjtcblxuLy8gTm9kZSBjcnlwdG8gZm9yIGhhc2hpbmcgYW5kIEhNQUNcbmltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiO1xuXG5mdW5jdGlvbiBiYXNlNjR1cmwoYnVmOiBCdWZmZXIpIHtcbiAgcmV0dXJuIGJ1ZlxuICAgIC50b1N0cmluZyhcImJhc2U2NFwiKVxuICAgIC5yZXBsYWNlKC9cXCsvZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL1xcLy9nLCBcIl9cIilcbiAgICAucmVwbGFjZSgvPSskL2csIFwiXCIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwYmtkZjJIYXNoKHBhc3N3b3JkOiBzdHJpbmcsIHNhbHQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY3J5cHRvLnBia2RmMihcbiAgICAgIHBhc3N3b3JkLFxuICAgICAgQnVmZmVyLmZyb20oc2FsdCwgXCJiYXNlNjRcIiksXG4gICAgICAxNTAwMDAsXG4gICAgICAzMixcbiAgICAgIFwic2hhMjU2XCIsXG4gICAgICAoZXJyLCBkZXJpdmVkS2V5KSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgcmVzb2x2ZShiYXNlNjR1cmwoZGVyaXZlZEtleSkpO1xuICAgICAgfVxuICAgICk7XG4gIH0pO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzaFBhc3N3b3JkKHBhc3N3b3JkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBzYWx0ID0gY3J5cHRvLnJhbmRvbUJ5dGVzKDE2KS50b1N0cmluZyhcImJhc2U2NFwiKTtcbiAgY29uc3QgaGFzaCA9IGF3YWl0IHBia2RmMkhhc2gocGFzc3dvcmQsIHNhbHQpO1xuICByZXR1cm4gYHBia2RmMiRzaGEyNTYkMTUwMDAwJCR7c2FsdH0kJHtoYXNofWA7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlQYXNzd29yZChcbiAgcGFzc3dvcmQ6IHN0cmluZyxcbiAgc3RvcmVkOiBzdHJpbmdcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBwYXJ0cyA9IHN0b3JlZC5zcGxpdChcIiRcIik7XG4gIGlmIChwYXJ0cy5sZW5ndGggPCA2KSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNhbHQgPSBwYXJ0c1s0XTtcbiAgY29uc3Qgd2FudCA9IHBhcnRzWzVdO1xuICBjb25zdCBnb3QgPSBhd2FpdCBwYmtkZjJIYXNoKHBhc3N3b3JkLCBzYWx0KTtcbiAgcmV0dXJuIHRpbWluZ1NhZmVFcXVhbChnb3QsIHdhbnQpO1xufVxuXG5mdW5jdGlvbiB0aW1pbmdTYWZlRXF1YWwoYTogc3RyaW5nLCBiOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3QgYWEgPSBCdWZmZXIuZnJvbShhKTtcbiAgY29uc3QgYmIgPSBCdWZmZXIuZnJvbShiKTtcbiAgaWYgKGFhLmxlbmd0aCAhPT0gYmIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjcnlwdG8udGltaW5nU2FmZUVxdWFsKGFhLCBiYik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvb2tpZXMoY29va2llSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGlmICghY29va2llSGVhZGVyKSByZXR1cm4gb3V0O1xuICBjb29raWVIZWFkZXIuc3BsaXQoXCI7XCIpLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCBbaywgLi4ucmVzdF0gPSBwLnRyaW0oKS5zcGxpdChcIj1cIik7XG4gICAgb3V0W2tdID0gcmVzdC5qb2luKFwiPVwiKSB8fCBcIlwiO1xuICB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGb3VuZGVyR2F0ZXdheUtleShldmVudDogYW55KTogc3RyaW5nIHtcbiAgY29uc3QgaGVhZGVycyA9IGV2ZW50Py5oZWFkZXJzIHx8IHt9O1xuICByZXR1cm4gU3RyaW5nKFxuICAgIGhlYWRlcnNbXCJ4LWZvdW5kZXJzLWdhdGV3YXkta2V5XCJdIHx8XG4gICAgICBoZWFkZXJzW1wiWC1Gb3VuZGVycy1HYXRld2F5LUtleVwiXSB8fFxuICAgICAgaGVhZGVyc1tcIngtZm91bmRlci1nYXRld2F5LWtleVwiXSB8fFxuICAgICAgaGVhZGVyc1tcIlgtRm91bmRlci1HYXRld2F5LUtleVwiXSB8fFxuICAgICAgXCJcIlxuICApLnRyaW0oKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1ZhbGlkRm91bmRlckdhdGV3YXlLZXkocHJvdmlkZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBleHBlY3RlZCA9IG9wdChcIkZvdW5kZXJzX0dhdGVXYXlfS2V5XCIsIG9wdChcIkZPVU5ERVJTX0dBVEVXQVlfS0VZXCIsIFwiXCIpKTtcbiAgcmV0dXJuIHRpbWluZ1NhZmVFcXVhbChTdHJpbmcocHJvdmlkZWQgfHwgXCJcIiksIFN0cmluZyhleHBlY3RlZCB8fCBcIlwiKSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlRm91bmRlckdhdGV3YXlVc2VyKCk6IFByb21pc2U8e1xuICB1c2VyX2lkOiBzdHJpbmc7XG4gIGVtYWlsOiBzdHJpbmc7XG4gIG9yZ19pZDogc3RyaW5nIHwgbnVsbDtcbn0gfCBudWxsPiB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRFbWFpbCA9IFN0cmluZyhcbiAgICBvcHQoXCJGb3VuZGVyc19HYXRlV2F5X0VtYWlsXCIsIG9wdChcIkZPVU5ERVJTX0dBVEVXQVlfRU1BSUxcIiwgXCJcIikpXG4gIClcbiAgICAudHJpbSgpXG4gICAgLnRvTG93ZXJDYXNlKCk7XG5cbiAgY29uc3QgcmVhZFVzZXJCeUVtYWlsID0gYXN5bmMgKGVtYWlsOiBzdHJpbmcpID0+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBxKFxuICAgICAgYHNlbGVjdCB1LmlkIGFzIHVzZXJfaWQsIHUuZW1haWwsIGNvYWxlc2NlKHUub3JnX2lkLCBtLm9yZ19pZCkgYXMgb3JnX2lkXG4gICAgICAgICBmcm9tIHVzZXJzIHVcbiAgICAgICAgIGxlZnQgam9pbiBvcmdfbWVtYmVyc2hpcHMgbSBvbiBtLnVzZXJfaWQ9dS5pZFxuICAgICAgICB3aGVyZSBsb3dlcih1LmVtYWlsKT1sb3dlcigkMSlcbiAgICAgICAgb3JkZXIgYnkgY2FzZSB3aGVuIGxvd2VyKGNvYWxlc2NlKG0ucm9sZSwgJycpKT0nb3duZXInIHRoZW4gMCBlbHNlIDEgZW5kLFxuICAgICAgICAgICAgICAgICBjb2FsZXNjZShtLm9yZ19pZCwgdS5vcmdfaWQpIGFzYyxcbiAgICAgICAgICAgICAgICAgdS5pZCBhc2NcbiAgICAgICAgbGltaXQgMWAsXG4gICAgICBbZW1haWxdXG4gICAgKTtcbiAgICBpZiAoIXJlcy5yb3dzLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHtcbiAgICAgIHVzZXJfaWQ6IHJlcy5yb3dzWzBdLnVzZXJfaWQsXG4gICAgICBlbWFpbDogcmVzLnJvd3NbMF0uZW1haWwsXG4gICAgICBvcmdfaWQ6IHJlcy5yb3dzWzBdLm9yZ19pZCB8fCBudWxsLFxuICAgIH07XG4gIH07XG5cbiAgaWYgKGNvbmZpZ3VyZWRFbWFpbCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSBhd2FpdCByZWFkVXNlckJ5RW1haWwoY29uZmlndXJlZEVtYWlsKTtcbiAgICBpZiAoY29uZmlndXJlZCkgcmV0dXJuIGNvbmZpZ3VyZWQ7XG4gIH1cblxuICBjb25zdCBmb3VuZGVyTG9jYWwgPSBhd2FpdCByZWFkVXNlckJ5RW1haWwoXCJmb3VuZGVyQHNreWUubG9jYWxcIik7XG4gIGlmIChmb3VuZGVyTG9jYWwpIHJldHVybiBmb3VuZGVyTG9jYWw7XG5cbiAgY29uc3Qgb3duZXIgPSBhd2FpdCBxKFxuICAgIGBzZWxlY3QgdS5pZCBhcyB1c2VyX2lkLCB1LmVtYWlsLCBjb2FsZXNjZSh1Lm9yZ19pZCwgbS5vcmdfaWQpIGFzIG9yZ19pZFxuICAgICAgIGZyb20gb3JnX21lbWJlcnNoaXBzIG1cbiAgICAgICBqb2luIHVzZXJzIHUgb24gdS5pZD1tLnVzZXJfaWRcbiAgICAgIHdoZXJlIGxvd2VyKGNvYWxlc2NlKG0ucm9sZSwgJycpKT0nb3duZXInXG4gICAgICBvcmRlciBieSBtLm9yZ19pZCBhc2MsIHUuaWQgYXNjXG4gICAgICBsaW1pdCAxYCxcbiAgICBbXVxuICApO1xuICBpZiAoIW93bmVyLnJvd3MubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICB1c2VyX2lkOiBvd25lci5yb3dzWzBdLnVzZXJfaWQsXG4gICAgZW1haWw6IG93bmVyLnJvd3NbMF0uZW1haWwsXG4gICAgb3JnX2lkOiBvd25lci5yb3dzWzBdLm9yZ19pZCB8fCBudWxsLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWlyZVVzZXIoZXZlbnQ6IGFueSk6IFByb21pc2U8e1xuICB1c2VyX2lkOiBzdHJpbmc7XG4gIGVtYWlsOiBzdHJpbmc7XG4gIG9yZ19pZDogc3RyaW5nIHwgbnVsbDtcbn0gfCBudWxsPiB7XG4gIGNvbnN0IGNvb2tpZXMgPSBwYXJzZUNvb2tpZXMoZXZlbnQuaGVhZGVycz8uY29va2llKTtcbiAgY29uc3QgdG9rZW4gPSBjb29raWVzW0NPT0tJRV07XG4gIGlmICghdG9rZW4pIHJldHVybiBudWxsO1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIGNvbnN0IHNlc3MgPSBhd2FpdCBxKFxuICAgIFwic2VsZWN0IHMudG9rZW4sIHMudXNlcl9pZCwgdS5lbWFpbCwgdS5vcmdfaWQgZnJvbSBzZXNzaW9ucyBzIGpvaW4gdXNlcnMgdSBvbiB1LmlkPXMudXNlcl9pZCB3aGVyZSBzLnRva2VuPSQxIGFuZCBzLmV4cGlyZXNfYXQ+JDJcIixcbiAgICBbdG9rZW4sIG5vd11cbiAgKTtcbiAgaWYgKCFzZXNzLnJvd3MubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICB1c2VyX2lkOiBzZXNzLnJvd3NbMF0udXNlcl9pZCxcbiAgICBlbWFpbDogc2Vzcy5yb3dzWzBdLmVtYWlsLFxuICAgIG9yZ19pZDogc2Vzcy5yb3dzWzBdLm9yZ19pZCxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVNlc3Npb24odXNlcl9pZDogc3RyaW5nKSB7XG4gIGNvbnN0IHRva2VuID0gYmFzZTY0dXJsKGNyeXB0by5yYW5kb21CeXRlcygzMikpO1xuICBjb25zdCBleHBpcmVzID0gbmV3IERhdGUoRGF0ZS5ub3coKSArIDEwMDAgKiA2MCAqIDYwICogMjQgKiAxNCk7IC8vIDE0IGRheXNcbiAgYXdhaXQgcShcbiAgICBcImluc2VydCBpbnRvIHNlc3Npb25zKHVzZXJfaWQsIHRva2VuLCBleHBpcmVzX2F0KSB2YWx1ZXMoJDEsJDIsJDMpXCIsXG4gICAgW3VzZXJfaWQsIHRva2VuLCBleHBpcmVzLnRvSVNPU3RyaW5nKCldXG4gICk7XG4gIHJldHVybiB7IHRva2VuLCBleHBpcmVzIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVVc2VyUmVjb3ZlcnlFbWFpbENvbHVtbigpIHtcbiAgYXdhaXQgcShcImFsdGVyIHRhYmxlIGlmIGV4aXN0cyB1c2VycyBhZGQgY29sdW1uIGlmIG5vdCBleGlzdHMgcmVjb3ZlcnlfZW1haWwgdGV4dFwiLCBbXSk7XG4gIGF3YWl0IHEoXCJjcmVhdGUgaW5kZXggaWYgbm90IGV4aXN0cyBpZHhfdXNlcnNfcmVjb3ZlcnlfZW1haWwgb24gdXNlcnMobG93ZXIocmVjb3ZlcnlfZW1haWwpKVwiLCBbXSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVVc2VyUGluQ29sdW1ucygpIHtcbiAgYXdhaXQgcShcImFsdGVyIHRhYmxlIGlmIGV4aXN0cyB1c2VycyBhZGQgY29sdW1uIGlmIG5vdCBleGlzdHMgcGluX2hhc2ggdGV4dFwiLCBbXSk7XG4gIGF3YWl0IHEoXCJhbHRlciB0YWJsZSBpZiBleGlzdHMgdXNlcnMgYWRkIGNvbHVtbiBpZiBub3QgZXhpc3RzIHBpbl91cGRhdGVkX2F0IHRpbWVzdGFtcHR6XCIsIFtdKTtcbn1cblxuZnVuY3Rpb24gc2hvdWxkVXNlU2VjdXJlQ29va2llKGV2ZW50PzogYW55KTogYm9vbGVhbiB7XG4gIGNvbnN0IHByb3RvSGVhZGVyID0gU3RyaW5nKFxuICAgIGV2ZW50Py5oZWFkZXJzPy5bXCJ4LWZvcndhcmRlZC1wcm90b1wiXSB8fFxuICAgICAgZXZlbnQ/LmhlYWRlcnM/LltcIlgtRm9yd2FyZGVkLVByb3RvXCJdIHx8XG4gICAgICBcIlwiXG4gIClcbiAgICAuc3BsaXQoXCIsXCIpWzBdXG4gICAgLnRyaW0oKVxuICAgIC50b0xvd2VyQ2FzZSgpO1xuXG4gIGlmIChwcm90b0hlYWRlciA9PT0gXCJodHRwc1wiKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHByb3RvSGVhZGVyID09PSBcImh0dHBcIikgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGhvc3QgPSBTdHJpbmcoZXZlbnQ/LmhlYWRlcnM/Lmhvc3QgfHwgZXZlbnQ/LmhlYWRlcnM/Lkhvc3QgfHwgXCJcIilcbiAgICAudHJpbSgpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAuc3BsaXQoXCI6XCIpWzBdO1xuXG4gIGlmICghaG9zdCkgcmV0dXJuIHRydWU7XG4gIGlmIChob3N0ID09PSBcImxvY2FsaG9zdFwiIHx8IGhvc3QgPT09IFwiMTI3LjAuMC4xXCIgfHwgaG9zdCA9PT0gXCI6OjFcIiB8fCBob3N0LmVuZHNXaXRoKFwiLmxvY2FsaG9zdFwiKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0U2Vzc2lvbkNvb2tpZSh0b2tlbjogc3RyaW5nLCBleHBpcmVzOiBEYXRlLCBldmVudD86IGFueSk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtDT09LSUV9PSR7dG9rZW59OyBQYXRoPS87IEh0dHBPbmx5OyBTYW1lU2l0ZT1MYXg7JHtzaG91bGRVc2VTZWN1cmVDb29raWUoZXZlbnQpID8gXCIgU2VjdXJlO1wiIDogXCJcIn0gRXhwaXJlcz0ke2V4cGlyZXMudG9VVENTdHJpbmcoKX1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJTZXNzaW9uQ29va2llKGV2ZW50PzogYW55KTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke0NPT0tJRX09OyBQYXRoPS87IEh0dHBPbmx5OyBTYW1lU2l0ZT1MYXg7JHtzaG91bGRVc2VTZWN1cmVDb29raWUoZXZlbnQpID8gXCIgU2VjdXJlO1wiIDogXCJcIn0gRXhwaXJlcz1UaHUsIDAxIEphbiAxOTcwIDAwOjAwOjAwIEdNVGA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JiaWQoKSB7XG4gIHJldHVybiBqc29uKDQwMSwgeyBlcnJvcjogXCJVbmF1dGhvcml6ZWRcIiB9KTtcbn0iLCAiaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcblxuLyoqXG4gKiBSZWNvcmQgYW4gYXVkaXQgZXZlbnQgaW4gdGhlIGRhdGFiYXNlLiAgQWxsIGNvbnNlcXVlbnRpYWxcbiAqIG9wZXJhdGlvbnMgc2hvdWxkIGVtaXQgYW4gYXVkaXQgZXZlbnQgd2l0aCBhY3Rvciwgb3JnLCB3b3Jrc3BhY2UsXG4gKiB0eXBlIGFuZCBhcmJpdHJhcnkgbWV0YWRhdGEuICBFcnJvcnMgYXJlIHN3YWxsb3dlZCBzaWxlbnRseVxuICogYmVjYXVzZSBhdWRpdCBsb2dnaW5nIG11c3QgbmV2ZXIgYnJlYWsgdXNlciBmbG93cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGF1ZGl0KFxuICBhY3Rvcjogc3RyaW5nLFxuICBvcmdfaWQ6IHN0cmluZyB8IG51bGwsXG4gIHdzX2lkOiBzdHJpbmcgfCBudWxsLFxuICB0eXBlOiBzdHJpbmcsXG4gIG1ldGE6IGFueVxuKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgcShcbiAgICAgIFwiaW5zZXJ0IGludG8gYXVkaXRfZXZlbnRzKGFjdG9yLCBvcmdfaWQsIHdzX2lkLCB0eXBlLCBtZXRhKSB2YWx1ZXMoJDEsJDIsJDMsJDQsJDU6Ompzb25iKVwiLFxuICAgICAgW2FjdG9yLCBvcmdfaWQsIHdzX2lkLCB0eXBlLCBKU09OLnN0cmluZ2lmeShtZXRhID8/IHt9KV1cbiAgICApO1xuICB9IGNhdGNoIChfKSB7XG4gICAgLy8gaWdub3JlIGF1ZGl0IGZhaWx1cmVzXG4gIH1cbn0iLCAiaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcblxuZXhwb3J0IHR5cGUgQnJhaW5Vc2FnZVNuYXBzaG90ID0ge1xuICBwcm9tcHRfdG9rZW5zOiBudW1iZXIgfCBudWxsO1xuICBjb21wbGV0aW9uX3Rva2VuczogbnVtYmVyIHwgbnVsbDtcbiAgdG90YWxfdG9rZW5zOiBudW1iZXIgfCBudWxsO1xuICBleGFjdDogYm9vbGVhbjtcbiAgc291cmNlOiBcInByb3ZpZGVyXCIgfCBcImVzdGltYXRlZFwiO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29yZEJyYWluVXNhZ2UobWV0YToge1xuICBhY3Rvcjogc3RyaW5nO1xuICBhY3Rvcl9lbWFpbD86IHN0cmluZyB8IG51bGw7XG4gIGFjdG9yX3VzZXJfaWQ/OiBzdHJpbmcgfCBudWxsO1xuICBvcmdfaWQ/OiBzdHJpbmcgfCBudWxsO1xuICB3c19pZD86IHN0cmluZyB8IG51bGw7XG4gIGFwcDogc3RyaW5nO1xuICBhdXRoX3R5cGU/OiBzdHJpbmcgfCBudWxsO1xuICBhcGlfdG9rZW5faWQ/OiBzdHJpbmcgfCBudWxsO1xuICBhcGlfdG9rZW5fbGFiZWw/OiBzdHJpbmcgfCBudWxsO1xuICBhcGlfdG9rZW5fbG9ja2VkX2VtYWlsPzogc3RyaW5nIHwgbnVsbDtcbiAgdXNlZF9iYWNrdXA6IGJvb2xlYW47XG4gIGJyYWluX3JvdXRlOiBcInByaW1hcnlcIiB8IFwiYmFja3VwXCI7XG4gIHByb3ZpZGVyPzogc3RyaW5nIHwgbnVsbDtcbiAgbW9kZWw/OiBzdHJpbmcgfCBudWxsO1xuICBnYXRld2F5X3JlcXVlc3RfaWQ/OiBzdHJpbmcgfCBudWxsO1xuICBiYWNrdXBfcmVxdWVzdF9pZD86IHN0cmluZyB8IG51bGw7XG4gIGdhdGV3YXlfc3RhdHVzPzogbnVtYmVyIHwgbnVsbDtcbiAgYmFja3VwX3N0YXR1cz86IG51bWJlciB8IG51bGw7XG4gIHVzYWdlOiBCcmFpblVzYWdlU25hcHNob3Q7XG4gIGJpbGxpbmc/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG59KSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgcShcbiAgICAgIGBpbnNlcnQgaW50byBhaV9icmFpbl91c2FnZV9sb2coXG4gICAgICAgIGFjdG9yLFxuICAgICAgICBhY3Rvcl9lbWFpbCxcbiAgICAgICAgYWN0b3JfdXNlcl9pZCxcbiAgICAgICAgb3JnX2lkLFxuICAgICAgICB3c19pZCxcbiAgICAgICAgYXBwLFxuICAgICAgICBhdXRoX3R5cGUsXG4gICAgICAgIGFwaV90b2tlbl9pZCxcbiAgICAgICAgYXBpX3Rva2VuX2xhYmVsLFxuICAgICAgICBhcGlfdG9rZW5fbG9ja2VkX2VtYWlsLFxuICAgICAgICB1c2VkX2JhY2t1cCxcbiAgICAgICAgYnJhaW5fcm91dGUsXG4gICAgICAgIHByb3ZpZGVyLFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgZ2F0ZXdheV9yZXF1ZXN0X2lkLFxuICAgICAgICBiYWNrdXBfcmVxdWVzdF9pZCxcbiAgICAgICAgZ2F0ZXdheV9zdGF0dXMsXG4gICAgICAgIGJhY2t1cF9zdGF0dXMsXG4gICAgICAgIHVzYWdlX2pzb24sXG4gICAgICAgIGJpbGxpbmdfanNvbixcbiAgICAgICAgc3VjY2Vzc1xuICAgICAgKSB2YWx1ZXMgKFxuICAgICAgICAkMSwkMiwkMywkNCwkNSwkNiwkNywkOCwkOSwkMTAsJDExLCQxMiwkMTMsJDE0LCQxNSwkMTYsJDE3LCQxOCwkMTk6Ompzb25iLCQyMDo6anNvbmIsJDIxXG4gICAgICApYCxcbiAgICAgIFtcbiAgICAgICAgbWV0YS5hY3RvcixcbiAgICAgICAgbWV0YS5hY3Rvcl9lbWFpbCB8fCBudWxsLFxuICAgICAgICBtZXRhLmFjdG9yX3VzZXJfaWQgfHwgbnVsbCxcbiAgICAgICAgbWV0YS5vcmdfaWQgfHwgbnVsbCxcbiAgICAgICAgbWV0YS53c19pZCB8fCBudWxsLFxuICAgICAgICBtZXRhLmFwcCxcbiAgICAgICAgbWV0YS5hdXRoX3R5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgIG1ldGEuYXBpX3Rva2VuX2lkIHx8IG51bGwsXG4gICAgICAgIG1ldGEuYXBpX3Rva2VuX2xhYmVsIHx8IG51bGwsXG4gICAgICAgIG1ldGEuYXBpX3Rva2VuX2xvY2tlZF9lbWFpbCB8fCBudWxsLFxuICAgICAgICBCb29sZWFuKG1ldGEudXNlZF9iYWNrdXApLFxuICAgICAgICBtZXRhLmJyYWluX3JvdXRlLFxuICAgICAgICBtZXRhLnByb3ZpZGVyIHx8IG51bGwsXG4gICAgICAgIG1ldGEubW9kZWwgfHwgbnVsbCxcbiAgICAgICAgbWV0YS5nYXRld2F5X3JlcXVlc3RfaWQgfHwgbnVsbCxcbiAgICAgICAgbWV0YS5iYWNrdXBfcmVxdWVzdF9pZCB8fCBudWxsLFxuICAgICAgICBtZXRhLmdhdGV3YXlfc3RhdHVzID8/IG51bGwsXG4gICAgICAgIG1ldGEuYmFja3VwX3N0YXR1cyA/PyBudWxsLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShtZXRhLnVzYWdlIHx8IHt9KSxcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkobWV0YS5iaWxsaW5nIHx8IHt9KSxcbiAgICAgICAgbWV0YS5zdWNjZXNzICE9PSBmYWxzZSxcbiAgICAgIF1cbiAgICApO1xuICB9IGNhdGNoIHtcbiAgICAvLyBVc2FnZSBsb2dnaW5nIG11c3Qgbm90IGJsb2NrIHVzZXIgZmxvd3MuXG4gIH1cbn0iLCAiaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcblxuZnVuY3Rpb24gZXNjYXBlUmVnZXgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG59XG5cbmZ1bmN0aW9uIGdsb2JUb1JlZ2V4KGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBnbG9iLnRyaW0oKS5yZXBsYWNlKC9eXFwvKy8sIFwiXCIpO1xuICBjb25zdCBlc2NhcGVkID0gZXNjYXBlUmVnZXgobm9ybWFsaXplZClcbiAgICAucmVwbGFjZSgvXFxcXFxcKlxcXFxcXCovZywgXCIuKlwiKVxuICAgIC5yZXBsYWNlKC9cXFxcXFwqL2csIFwiW14vXSpcIik7XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtlc2NhcGVkfSRgLCBcImlcIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTa25vcmVQYXR0ZXJucyhwYXR0ZXJuczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIHJldHVybiBBcnJheS5mcm9tKFxuICAgIG5ldyBTZXQoXG4gICAgICAocGF0dGVybnMgfHwgW10pXG4gICAgICAgIC5tYXAoKHApID0+IFN0cmluZyhwIHx8IFwiXCIpLnRyaW0oKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgICAubWFwKChwKSA9PiBwLnJlcGxhY2UoL15cXC8rLywgXCJcIikpXG4gICAgKVxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNTa25vcmVQcm90ZWN0ZWQocGF0aDogc3RyaW5nLCBwYXR0ZXJuczogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgY29uc3QgdGFyZ2V0ID0gU3RyaW5nKHBhdGggfHwgXCJcIikucmVwbGFjZSgvXlxcLysvLCBcIlwiKTtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVNrbm9yZVBhdHRlcm5zKHBhdHRlcm5zKTtcbiAgcmV0dXJuIG5vcm1hbGl6ZWQuc29tZSgocGF0dGVybikgPT4gZ2xvYlRvUmVnZXgocGF0dGVybikudGVzdCh0YXJnZXQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlclNrbm9yZUZpbGVzPFQgZXh0ZW5kcyB7IHBhdGg6IHN0cmluZyB9PihmaWxlczogVFtdLCBwYXR0ZXJuczogc3RyaW5nW10pOiBUW10ge1xuICByZXR1cm4gKGZpbGVzIHx8IFtdKS5maWx0ZXIoKGYpID0+ICFpc1Nrbm9yZVByb3RlY3RlZChmLnBhdGgsIHBhdHRlcm5zKSk7XG59XG5cbmV4cG9ydCB0eXBlIFdvcmtzcGFjZVRleHRGaWxlID0ge1xuICBwYXRoOiBzdHJpbmc7XG4gIGNvbnRlbnQ6IHN0cmluZztcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVXb3Jrc3BhY2VUZXh0RmlsZXMoZmlsZXM6IGFueVtdKTogV29ya3NwYWNlVGV4dEZpbGVbXSB7XG4gIHJldHVybiAoQXJyYXkuaXNBcnJheShmaWxlcykgPyBmaWxlcyA6IFtdKVxuICAgIC5tYXAoKGZpbGU6IGFueSkgPT4gKHtcbiAgICAgIHBhdGg6IFN0cmluZyhmaWxlPy5wYXRoIHx8IFwiXCIpLnJlcGxhY2UoL15cXC8rLywgXCJcIiksXG4gICAgICBjb250ZW50OiB0eXBlb2YgZmlsZT8uY29udGVudCA9PT0gXCJzdHJpbmdcIiA/IGZpbGUuY29udGVudCA6IFwiXCIsXG4gICAgfSkpXG4gICAgLmZpbHRlcigoZmlsZSkgPT4gZmlsZS5wYXRoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJ1aWxkU2tub3JlUmVsZWFzZVBsYW4ob3JnSWQ6IHN0cmluZywgd3NJZDogc3RyaW5nLCByYXdGaWxlcz86IGFueVtdKTogUHJvbWlzZTx7XG4gIHdvcmtzcGFjZU5hbWU6IHN0cmluZyB8IG51bGw7XG4gIGZpbGVzOiBXb3Jrc3BhY2VUZXh0RmlsZVtdO1xuICByZWxlYXNlRmlsZXM6IFdvcmtzcGFjZVRleHRGaWxlW107XG4gIGJsb2NrZWRQYXRoczogc3RyaW5nW107XG4gIHBhdHRlcm5zOiBzdHJpbmdbXTtcbn0+IHtcbiAgY29uc3Qgd29ya3NwYWNlID0gYXdhaXQgcShcbiAgICBgc2VsZWN0IG9yZ19pZCwgbmFtZSwgZmlsZXNfanNvblxuICAgICAgIGZyb20gd29ya3NwYWNlc1xuICAgICAgd2hlcmUgaWQ9JDFcbiAgICAgIGxpbWl0IDFgLFxuICAgIFt3c0lkXVxuICApO1xuXG4gIGlmICghd29ya3NwYWNlLnJvd3MubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiV29ya3NwYWNlIG5vdCBmb3VuZC5cIik7XG4gIH1cbiAgaWYgKHdvcmtzcGFjZS5yb3dzWzBdLm9yZ19pZCAhPT0gb3JnSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJGb3JiaWRkZW4uXCIpO1xuICB9XG5cbiAgY29uc3QgZmlsZXMgPSBub3JtYWxpemVXb3Jrc3BhY2VUZXh0RmlsZXMoXG4gICAgQXJyYXkuaXNBcnJheShyYXdGaWxlcykgPyByYXdGaWxlcyA6IHdvcmtzcGFjZS5yb3dzWzBdLmZpbGVzX2pzb24gfHwgW11cbiAgKTtcbiAgY29uc3QgcGF0dGVybnMgPSBhd2FpdCBsb2FkU2tub3JlUG9saWN5KG9yZ0lkLCB3c0lkKTtcbiAgY29uc3QgYmxvY2tlZFBhdGhzID0gZmlsZXNcbiAgICAuZmlsdGVyKChmaWxlKSA9PiBpc1Nrbm9yZVByb3RlY3RlZChmaWxlLnBhdGgsIHBhdHRlcm5zKSlcbiAgICAubWFwKChmaWxlKSA9PiBmaWxlLnBhdGgpO1xuICBjb25zdCByZWxlYXNlRmlsZXMgPSBmaWx0ZXJTa25vcmVGaWxlcyhmaWxlcywgcGF0dGVybnMpO1xuXG4gIHJldHVybiB7XG4gICAgd29ya3NwYWNlTmFtZTogd29ya3NwYWNlLnJvd3NbMF0ubmFtZSB8fCBudWxsLFxuICAgIGZpbGVzLFxuICAgIHJlbGVhc2VGaWxlcyxcbiAgICBibG9ja2VkUGF0aHMsXG4gICAgcGF0dGVybnMsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkU2tub3JlUG9saWN5KG9yZ0lkOiBzdHJpbmcsIHdzSWQ6IHN0cmluZyB8IG51bGwpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHNjb3BlZCA9IHdzSWRcbiAgICA/IGF3YWl0IHEoXG4gICAgICAgIGBzZWxlY3QgcGF5bG9hZFxuICAgICAgICAgZnJvbSBhcHBfcmVjb3Jkc1xuICAgICAgICAgd2hlcmUgb3JnX2lkPSQxIGFuZCBhcHA9J1NLTm9yZVBvbGljeScgYW5kIHdzX2lkPSQyXG4gICAgICAgICBvcmRlciBieSB1cGRhdGVkX2F0IGRlc2NcbiAgICAgICAgIGxpbWl0IDFgLFxuICAgICAgICBbb3JnSWQsIHdzSWRdXG4gICAgICApXG4gICAgOiB7IHJvd3M6IFtdIGFzIGFueVtdIH07XG5cbiAgaWYgKHNjb3BlZC5yb3dzLmxlbmd0aCkge1xuICAgIGNvbnN0IHBheWxvYWQgPSBzY29wZWQucm93c1swXT8ucGF5bG9hZCB8fCB7fTtcbiAgICByZXR1cm4gbm9ybWFsaXplU2tub3JlUGF0dGVybnMoQXJyYXkuaXNBcnJheShwYXlsb2FkLnBhdHRlcm5zKSA/IHBheWxvYWQucGF0dGVybnMgOiBbXSk7XG4gIH1cblxuICBjb25zdCBvcmdXaWRlID0gYXdhaXQgcShcbiAgICBgc2VsZWN0IHBheWxvYWRcbiAgICAgZnJvbSBhcHBfcmVjb3Jkc1xuICAgICB3aGVyZSBvcmdfaWQ9JDEgYW5kIGFwcD0nU0tOb3JlUG9saWN5JyBhbmQgd3NfaWQgaXMgbnVsbFxuICAgICBvcmRlciBieSB1cGRhdGVkX2F0IGRlc2NcbiAgICAgbGltaXQgMWAsXG4gICAgW29yZ0lkXVxuICApO1xuXG4gIGlmICghb3JnV2lkZS5yb3dzLmxlbmd0aCkgcmV0dXJuIFtdO1xuICBjb25zdCBwYXlsb2FkID0gb3JnV2lkZS5yb3dzWzBdPy5wYXlsb2FkIHx8IHt9O1xuICByZXR1cm4gbm9ybWFsaXplU2tub3JlUGF0dGVybnMoQXJyYXkuaXNBcnJheShwYXlsb2FkLnBhdHRlcm5zKSA/IHBheWxvYWQucGF0dGVybnMgOiBbXSk7XG59XG4iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgY29uc3QgQUxMT1dFRF9UT0tFTl9TQ09QRVMgPSBbXG4gIFwiZ2VuZXJhdGVcIixcbiAgXCJkZXBsb3lcIixcbiAgXCJleHBvcnRcIixcbiAgXCJhZG1pblwiLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgVG9rZW5TY29wZSA9ICh0eXBlb2YgQUxMT1dFRF9UT0tFTl9TQ09QRVMpW251bWJlcl07XG5cbmZ1bmN0aW9uIGJhc2U2NHVybChidWY6IEJ1ZmZlcikge1xuICByZXR1cm4gYnVmXG4gICAgLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gICAgLnJlcGxhY2UoL1xcKy9nLCBcIi1cIilcbiAgICAucmVwbGFjZSgvXFwvL2csIFwiX1wiKVxuICAgIC5yZXBsYWNlKC89KyQvZywgXCJcIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtaW50QXBpVG9rZW4oKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBreF9hdF8ke2Jhc2U2NHVybChjcnlwdG8ucmFuZG9tQnl0ZXMoMzIpKX1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5IYXNoKHRva2VuOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHRva2VuKS5kaWdlc3QoXCJoZXhcIik7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQXBpVG9rZW4odG9rZW46IHN0cmluZyk6IFByb21pc2U8e1xuICBpZDogc3RyaW5nO1xuICBvcmdfaWQ6IHN0cmluZztcbiAgbGFiZWw6IHN0cmluZyB8IG51bGw7XG4gIGlzc3VlZF9ieTogc3RyaW5nIHwgbnVsbDtcbiAgbG9ja2VkX2VtYWlsOiBzdHJpbmcgfCBudWxsO1xuICBzY29wZXM6IHN0cmluZ1tdO1xufSB8IG51bGw+IHtcbiAgY29uc3QgaGFzaCA9IHRva2VuSGFzaCh0b2tlbik7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IHEoXG4gICAgXCJzZWxlY3QgaWQsIG9yZ19pZCwgbGFiZWwsIGlzc3VlZF9ieSwgbG9ja2VkX2VtYWlsLCBzY29wZXNfanNvbiBmcm9tIGFwaV90b2tlbnMgd2hlcmUgdG9rZW5faGFzaD0kMSBhbmQgc3RhdHVzPSdhY3RpdmUnIGFuZCAoZXhwaXJlc19hdCBpcyBudWxsIG9yIGV4cGlyZXNfYXQgPiBub3coKSkgbGltaXQgMVwiLFxuICAgIFtoYXNoXVxuICApO1xuICBpZiAoIXJlcy5yb3dzLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJvdyA9IHJlcy5yb3dzWzBdO1xuICBhd2FpdCBxKFwidXBkYXRlIGFwaV90b2tlbnMgc2V0IGxhc3RfdXNlZF9hdD1ub3coKSB3aGVyZSBpZD0kMVwiLCBbcm93LmlkXSk7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBvcmdfaWQ6IHJvdy5vcmdfaWQsXG4gICAgbGFiZWw6IHJvdy5sYWJlbCB8fCBudWxsLFxuICAgIGlzc3VlZF9ieTogcm93Lmlzc3VlZF9ieSB8fCBudWxsLFxuICAgIGxvY2tlZF9lbWFpbDogcm93LmxvY2tlZF9lbWFpbCB8fCBudWxsLFxuICAgIHNjb3BlczogQXJyYXkuaXNBcnJheShyb3cuc2NvcGVzX2pzb24pID8gcm93LnNjb3Blc19qc29uLm1hcChTdHJpbmcpIDogW1wiZ2VuZXJhdGVcIl0sXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQmVhcmVyVG9rZW4oaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB2YWx1ZSA9XG4gICAgaGVhZGVycy5hdXRob3JpemF0aW9uIHx8XG4gICAgaGVhZGVycy5BdXRob3JpemF0aW9uIHx8XG4gICAgaGVhZGVycy5BVVRIT1JJWkFUSU9OIHx8XG4gICAgXCJcIjtcbiAgY29uc3QgbSA9IHZhbHVlLm1hdGNoKC9eQmVhcmVyXFxzKyguKykkL2kpO1xuICByZXR1cm4gbSA/IG1bMV0udHJpbSgpIDogbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc1ZhbGlkTWFzdGVyU2VxdWVuY2UocHJvdmlkZWQ6IHN0cmluZywgZXhwZWN0ZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBhID0gU3RyaW5nKHByb3ZpZGVkIHx8IFwiXCIpO1xuICBjb25zdCBiID0gU3RyaW5nKGV4cGVjdGVkIHx8IFwiXCIpO1xuICBpZiAoIWEgfHwgIWIpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYWEgPSBCdWZmZXIuZnJvbShhKTtcbiAgY29uc3QgYmIgPSBCdWZmZXIuZnJvbShiKTtcbiAgaWYgKGFhLmxlbmd0aCAhPT0gYmIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBjcnlwdG8udGltaW5nU2FmZUVxdWFsKGFhLCBiYik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVUb2tlblNjb3BlcyhpbnB1dDogYW55KTogc3RyaW5nW10ge1xuICBjb25zdCByYXcgPSBBcnJheS5pc0FycmF5KGlucHV0KSA/IGlucHV0Lm1hcCgoeCkgPT4gU3RyaW5nKHgpLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSA6IFtdO1xuICBjb25zdCBkZWR1cGVkID0gQXJyYXkuZnJvbShuZXcgU2V0KHJhdy5maWx0ZXIoQm9vbGVhbikpKTtcbiAgY29uc3QgdmFsaWQgPSBkZWR1cGVkLmZpbHRlcigocykgPT4gQUxMT1dFRF9UT0tFTl9TQ09QRVMuaW5jbHVkZXMocyBhcyBUb2tlblNjb3BlKSk7XG4gIHJldHVybiB2YWxpZC5sZW5ndGggPyB2YWxpZCA6IFtcImdlbmVyYXRlXCJdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5IYXNTY29wZShzY29wZXM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCByZXF1aXJlZDogVG9rZW5TY29wZSk6IGJvb2xlYW4ge1xuICBjb25zdCBhY3R1YWwgPSBBcnJheS5pc0FycmF5KHNjb3BlcykgPyBzY29wZXMgOiBbXTtcbiAgcmV0dXJuIGFjdHVhbC5pbmNsdWRlcyhyZXF1aXJlZCkgfHwgYWN0dWFsLmluY2x1ZGVzKFwiYWRtaW5cIik7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBQUEsT0FBT0EsYUFBWTs7O0FDTVosU0FBUyxLQUFLLE1BQXNCO0FBQ3pDLFFBQU0sSUFBSSxRQUFRLElBQUksSUFBSTtBQUMxQixNQUFJLENBQUMsRUFBRyxPQUFNLElBQUksTUFBTSxvQkFBb0IsSUFBSSxFQUFFO0FBQ2xELFNBQU87QUFDVDtBQUVPLFNBQVMsSUFBSSxNQUFjLFdBQVcsSUFBWTtBQUN2RCxTQUFPLFFBQVEsSUFBSSxJQUFJLEtBQUs7QUFDOUI7OztBQ1pBLFNBQVMsa0JBQWtCLEtBQW9FO0FBQzdGLE1BQUksZ0JBQWdCLEtBQUssR0FBRyxHQUFHO0FBQzdCLFdBQU87QUFBQSxNQUNMLFVBQVU7QUFBQSxNQUNWLFNBQVMsRUFBRSxnQkFBZ0IsbUJBQW1CO0FBQUEsSUFDaEQ7QUFBQSxFQUNGO0FBRUEsTUFBSSx1QkFBdUIsS0FBSyxHQUFHLEdBQUc7QUFDcEMsVUFBTSxTQUFTLElBQUksSUFBSSxHQUFHO0FBQzFCLFVBQU0sV0FB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QWMsT0FBTyxPQUFPLFFBQVEsSUFBSSxjQUFjLEtBQUssRUFBRSxFQUFFLFlBQVk7QUFDakYsUUFBSSxPQUFPLE1BQU0sWUFBWSxTQUFTLG1CQUFtQixLQUFLLE9BQU8sTUFBTTtBQUN6RSxZQUFNLGtCQUFrQixPQUFPLE9BQU8sUUFBUSxJQUFJLG9CQUFvQixLQUFLLEVBQUUsRUFBRSxLQUFLLEtBQUs7QUFDekYsWUFBTSxNQUFNLFlBQVksVUFBVSxNQUFNLDRCQUE0QjtBQUFBLFFBQ2xFO0FBQUEsUUFDQSxhQUFhLFVBQVU7QUFBQSxRQUN2QixPQUFPO0FBQUEsUUFDUCxhQUFhO0FBQUEsUUFDYixtQkFBbUI7QUFBQSxNQUNyQixDQUFDO0FBQ0QsYUFBTyxrQkFBa0I7QUFBQSxRQUN2QixVQUFVO0FBQUEsUUFDVixPQUFPO0FBQUEsUUFDUDtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBLFlBQVksZ0JBQWdCLE1BQU07QUFBQSxRQUNsQyxlQUFlLGdCQUFnQixTQUFTO0FBQUEsUUFDeEMscUJBQXFCLGdCQUFnQixnQkFBZ0Isb0JBQW9CO0FBQUEsUUFDekUsS0FBSztBQUFBLFFBQ0wsT0FBTztBQUFBLFFBQ1A7QUFBQSxRQUNBO0FBQUEsUUFDQSxlQUFlO0FBQUEsUUFDZixjQUFjLE9BQU87QUFBQSxRQUNyQixrQkFBa0I7QUFBQSxRQUNsQjtBQUFBLFFBQ0E7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQ0EsVUFBTSxTQUFTLE1BQU0sT0FBTyxLQUFLLEVBQUUsTUFBTSxNQUFNLEVBQUU7QUFDakQsVUFBTSxNQUFNLFlBQVksVUFBVSxNQUFNLHFDQUFxQztBQUFBLE1BQzNFO0FBQUEsTUFDQSxhQUFhLFVBQVU7QUFBQSxNQUN2QixPQUFPO0FBQUEsTUFDUCxRQUFRLE9BQU87QUFBQSxNQUNmLFFBQVEsT0FBTyxNQUFNLEdBQUcsR0FBRztBQUFBLElBQzdCLENBQUM7QUFDRCxXQUFPLGFBQWEsS0FBSyxFQUFFLElBQUksT0FBTyxrQkFBa0IsT0FBTyxPQUFPLDBCQUEwQixPQUFPLE1BQU0sS0FBSyxDQUFDO0FBQUEsRUFDckgsU0FBUyxPQUFZO0FBQ25CLFVBQU0sTUFBTSxZQUFZLFVBQVUsTUFBTSxnQ0FBZ0M7QUFBQSxNQUN0RTtBQUFBLE1BQ0EsYUFBYSxVQUFVO0FBQUEsTUFDdkIsT0FBTyxPQUFPLE9BQU8sV0FBVyxTQUFTLHdCQUF3QixFQUFFLE1BQU0sR0FBRyxHQUFHO0FBQUEsSUFDakYsQ0FBQztBQUNELFdBQU8sYUFBYSxLQUFLLEVBQUUsSUFBSSxPQUFPLE9BQU8sMEJBQTBCLENBQUM7QUFBQSxFQUMxRTtBQUNGOyIsCiAgIm5hbWVzIjogWyJjcnlwdG8iLCAicGF5bG9hZCIsICJjcnlwdG8iXQp9Cg==
