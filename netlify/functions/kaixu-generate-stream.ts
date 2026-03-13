import crypto from "crypto";

import { requireUser, forbid } from "./_shared/auth";
import { opt, must } from "./_shared/env";
import { audit } from "./_shared/audit";
import { recordBrainUsage } from "./_shared/brain_usage";
import { filterSknoreFiles, isSknoreProtected, loadSknorePolicy } from "./_shared/sknore";
import { hasValidMasterSequence, readBearerToken, resolveApiToken, tokenHasScope } from "./_shared/api_tokens";

function jsonResponse(status: number, body: any) {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeKaixuGatewayEndpoint(raw: string): string {
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

function shouldUseBackup(status: number | null): boolean {
  if (status == null) return true;
  return status === 429 || status >= 500;
}

function estimateTokens(text: string): number | null {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function summarizeMessages(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((message) => `${String(message?.role || "user")}: ${String(message?.content || "")}`.trim())
    .filter(Boolean)
    .join("\n\n");
}

function extractStreamEventText(dataChunk: string): string {
  const trimmed = String(dataChunk || "").trim();
  if (!trimmed || trimmed === "[DONE]") return "";
  try {
    const parsed = JSON.parse(trimmed);
    return String(
      parsed?.text ||
      parsed?.output ||
      parsed?.delta?.content ||
      parsed?.choices?.[0]?.delta?.content ||
      parsed?.choices?.[0]?.message?.content ||
      parsed?.candidates?.[0]?.content?.parts?.map((part: any) => String(part?.text || "")).join("") ||
      ""
    ).trim();
  } catch {
    return trimmed;
  }
}

function createUsageFromStream(messages: Array<{ role: string; content: string }>, outputText: string) {
  const promptTokens = estimateTokens(summarizeMessages(messages));
  const completionTokens = estimateTokens(outputText);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens:
      promptTokens == null && completionTokens == null
        ? null
        : (promptTokens || 0) + (completionTokens || 0),
    exact: false,
    source: "estimated" as const,
  };
}

function sseHeaders(extraHeaders: Headers | Record<string, string> = {}) {
  const headers = new Headers(extraHeaders as HeadersInit);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  return headers;
}

function buildRunnerHeaders(path: string, payload: any) {
  const secret = must("RUNNER_SHARED_SECRET");
  const ts = Date.now().toString();
  const body = JSON.stringify(payload ?? {});
  const canonical = `${ts}\n${path}\n${body}`;
  const sig = crypto.createHmac("sha256", secret).update(canonical).digest("base64url");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-KX-TS": ts,
    "X-KX-SIG": sig,
  };
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  if (accessClientId && accessClientSecret) {
    headers["CF-Access-Client-Id"] = accessClientId;
    headers["CF-Access-Client-Secret"] = accessClientSecret;
  }
  return { headers, body };
}

async function streamThrough(upstream: Response) {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: sseHeaders(upstream.headers),
  });
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
  messages,
}: {
  upstream: Response;
  actor: string;
  actorEmail: string;
  actorUserId: string | null;
  actorOrg: string | null;
  wsId: string;
  authType: "session" | "api_token" | "unknown";
  apiTokenId: string | null;
  apiTokenLabel: string | null;
  apiTokenLockedEmail: string | null;
  app: string;
  route: "primary" | "backup";
  provider: string;
  model: string;
  gatewayStatus: number | null;
  backupStatus: number | null;
  gatewayRequestId: string | null;
  backupRequestId: string | null;
  messages: Array<{ role: string; content: string }>;
}) {
  if (!upstream.body) {
    return new Response(null, {
      status: upstream.status,
      headers: sseHeaders(upstream.headers),
    });
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  let streamedText = "";

  const body = new ReadableStream<Uint8Array>({
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
            api_token_locked_email: apiTokenLockedEmail,
          },
          success: true,
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
          const dataLines = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .filter(Boolean);
          for (const dataChunk of dataLines) streamedText += extractStreamEventText(dataChunk);
        }
        controller.enqueue(value);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: upstream.status,
    headers: sseHeaders(upstream.headers),
  });
}

export default async (request: Request) => {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const headerBag = Object.fromEntries(request.headers.entries());
  const eventLike = { headers: { cookie: request.headers.get("cookie") || "", ...headerBag } };
  const u = await requireUser(eventLike as any);
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

  let body: any = {};
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

  const sknorePatterns = await loadSknorePolicy(actorOrg as string, wsId || null);
  if (activePath && isSknoreProtected(activePath, sknorePatterns)) {
    await audit(actorEmail, actorOrg, wsId, "sknore.blocked.active_path", {
      activePath,
      patterns_count: sknorePatterns.length,
    });
    return jsonResponse(403, {
      error: `SKNore policy blocks active file: ${activePath}`,
      code: "SKNORE_BLOCKED_ACTIVE_PATH",
    });
  }

  const safeFiles = filterSknoreFiles(files as Array<{ path: string }>, sknorePatterns);
  if (files.length !== safeFiles.length) {
    await audit(actorEmail, actorOrg, wsId, "sknore.blocked.files", {
      requested_files: files.length,
      allowed_files: safeFiles.length,
      patterns_count: sknorePatterns.length,
    });
  }

  const provider = String(opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London") || "Skyes Over London").trim() || "Skyes Over London";
  const model = String(body?.model || opt("KAIXU_GATEWAY_MODEL", "kAIxU-Prime6.7") || "kAIxU-Prime6.7").trim() || "kAIxU-Prime6.7";
  const messages = [
    {
      role: "system",
      content: "You are kAIxU inside Super IDE. Enforce plan-first. Output concise steps and patches. Speak directly to the user.",
    },
    {
      role: "user",
      content: `Active file: ${activePath || ""}\n\nUser prompt:\n${prompt}\n\nWorkspace snapshot:\n${JSON.stringify(safeFiles || []).slice(0, 120000)}`,
    },
  ];

  await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.requested", {
    activePath,
    filesLength: safeFiles.length,
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
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
    if (upstream.ok && contentType.includes("text/event-stream") && upstream.body) {
      const gatewayRequestId = String(upstream.headers.get("x-kaixu-request-id") || "").trim() || null;
      await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.ok", {
        activePath,
        filesLength: safeFiles.length,
        route: "primary",
        used_backup: false,
        gateway_request_id: gatewayRequestId,
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
        messages,
      });
    }

    if (!shouldUseBackup(upstream.status)) {
      const detail = await upstream.text().catch(() => "");
      await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.unavailable", {
        activePath,
        filesLength: safeFiles.length,
        route: "primary",
        status: upstream.status,
        detail: detail.slice(0, 400),
      });
      return jsonResponse(409, { ok: false, stream_supported: false, error: `Streaming unavailable (${upstream.status}).` });
    }
  } catch {
    // fall through to backup path
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
        actor_org: actorOrg,
      },
      brain_policy: {
        allow_backup: true,
        allow_user_direct: false,
      },
    });
    const backup = await fetch(`${runnerBase}${runnerPath}`, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    const contentType = String(backup.headers.get("content-type") || "").toLowerCase();
    if (backup.ok && contentType.includes("text/event-stream") && backup.body) {
      const backupRequestId = String(backup.headers.get("x-kaixu-request-id") || "").trim() || null;
      await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.ok", {
        activePath,
        filesLength: safeFiles.length,
        route: "backup",
        used_backup: true,
        backup_request_id: backupRequestId,
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
        messages,
      });
    }
    const detail = await backup.text().catch(() => "");
    await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.unavailable", {
      activePath,
      filesLength: safeFiles.length,
      route: "backup",
      status: backup.status,
      detail: detail.slice(0, 400),
    });
    return jsonResponse(409, { ok: false, stream_supported: false, error: `Streaming unavailable (${backup.status}).` });
  } catch (error: any) {
    await audit(actorEmail, actorOrg, wsId, "kaixu.generate.stream.failed", {
      activePath,
      filesLength: safeFiles.length,
      error: String(error?.message || error || "Stream request failed.").slice(0, 220),
    });
    return jsonResponse(502, { ok: false, error: "Streaming route failed." });
  }
};