import { must } from "./env";
import { runnerCallDetailed } from "./runner";

type BrainMessage = {
  role: string;
  content: string;
};

type BrainContext = {
  ws_id?: string | null;
  activePath?: string | null;
  app?: string | null;
  actor_email?: string | null;
  actor_org?: string | null;
  actor_user_id?: string | null;
  auth_type?: "session" | "api_token" | "unknown";
  api_token_id?: string | null;
  api_token_label?: string | null;
  api_token_locked_email?: string | null;
};

export type BrainUsage = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  exact: boolean;
  source: "provider" | "estimated";
};

type AttemptResult = {
  ok: boolean;
  status: number | null;
  text: string;
  error: string;
  detail: string | null;
  requestId: string | null;
  usage: BrainUsage;
};

type SuccessResult = {
  ok: true;
  text: string;
  brain: {
    route: "primary" | "backup";
    provider: string;
    model: string;
    request_id: string | null;
  };
  gateway_endpoint: string;
  gateway_status: number | null;
  gateway_request_id: string | null;
  backup_status: number | null;
  backup_request_id: string | null;
  token_fingerprint: string;
  configured_provider: string;
  effective_provider: string;
  effective_model: string;
  used_backup: boolean;
  usage: BrainUsage;
  billing: {
    actor_email: string | null;
    actor_user_id: string | null;
    auth_type: "session" | "api_token" | "unknown";
    api_token_id: string | null;
    api_token_label: string | null;
    api_token_locked_email: string | null;
  };
};

type FailureResult = {
  ok: false;
  status: number;
  error: string;
  brain: {
    route: "primary" | "backup";
    failed: true;
    provider: string;
    model: string;
    request_id: string | null;
  };
  gateway_endpoint: string;
  gateway_status: number | null;
  gateway_request_id: string | null;
  gateway_detail: string | null;
  backup_status: number | null;
  backup_request_id: string | null;
  backup_detail: string | null;
  backup_error: string | null;
  token_fingerprint: string;
  configured_provider: string;
  effective_provider: string;
  effective_model: string;
  used_backup: boolean;
  usage: BrainUsage;
  billing: {
    actor_email: string | null;
    actor_user_id: string | null;
    auth_type: "session" | "api_token" | "unknown";
    api_token_id: string | null;
    api_token_label: string | null;
    api_token_locked_email: string | null;
  };
};

export type KaixuBrainResult = SuccessResult | FailureResult;

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

function resolveKaixuGatewayProvider(raw: string): string {
  const value = String(raw || "").trim();
  return value || "Skyes Over London";
}

async function tokenFingerprint(token: string): Promise<string> {
  const normalized = String(token || "").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 4)}...len=${normalized.length} sha256=${hex.slice(0, 12)}`;
}

function compactErrorMessage(data: any, text: string): string {
  const msg =
    (typeof data?.error === "string" && data.error) ||
    (typeof data?.message === "string" && data.message) ||
    (typeof data?.raw === "string" && data.raw) ||
    text ||
    "Brain request failed.";
  return String(msg).replace(/\s+/g, " ").trim().slice(0, 220);
}

function extractReply(data: any, text: string): string {
  return String(data?.text || data?.output || data?.choices?.[0]?.message?.content || text || "").trim();
}

function pickFirstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  }
  return null;
}

function estimateTokens(text: string): number | null {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function summarizeMessages(messages: BrainMessage[]): string {
  return messages
    .map((message) => `${String(message?.role || "user")}: ${String(message?.content || "")}`.trim())
    .filter(Boolean)
    .join("\n\n");
}

function extractUsage(data: any, messages: BrainMessage[], reply: string): BrainUsage {
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
      source: "provider",
    };
  }
  const estimatedPrompt = estimateTokens(summarizeMessages(messages));
  const estimatedCompletion = estimateTokens(reply);
  return {
    prompt_tokens: estimatedPrompt,
    completion_tokens: estimatedCompletion,
    total_tokens:
      estimatedPrompt == null && estimatedCompletion == null
        ? null
        : (estimatedPrompt || 0) + (estimatedCompletion || 0),
    exact: false,
    source: "estimated",
  };
}

function shouldUseBackup(status: number | null, error: string): boolean {
  if (status == null) return true;
  return status === 429 || status >= 500;
}

async function callPrimaryBrain(endpoint: string, token: string, payload: Record<string, unknown>, messages: BrainMessage[]): Promise<AttemptResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: any = null;
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
        usage,
      };
    }
    return {
      ok: false,
      status: res.status,
      text: "",
      error: compactErrorMessage(data, text),
      detail: text.slice(0, 2000) || null,
      requestId,
      usage,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: null,
      text: "",
      error: String(e?.message || "Primary brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
      detail: null,
      requestId: null,
      usage: extractUsage(null, messages, ""),
    };
  }
}

async function callBackupBrain(payload: Record<string, unknown>, messages: BrainMessage[]): Promise<AttemptResult> {
  try {
    const { status, data } = await runnerCallDetailed<any>("/v1/brain/backup/generate", payload);
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
        usage,
      };
    }
    return {
      ok: false,
      status,
      text: "",
      error: compactErrorMessage(data, ""),
      detail: JSON.stringify(data || {}).slice(0, 2000) || null,
      requestId,
      usage,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: null,
      text: "",
      error: String(e?.message || "Backup brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
      detail: null,
      requestId: null,
      usage: extractUsage(null, messages, ""),
    };
  }
}

export async function callKaixuBrainWithFailover({
  bodyModel,
  defaultModel,
  providerRaw,
  messages,
  requestContext,
}: {
  bodyModel?: string;
  defaultModel?: string;
  providerRaw?: string;
  messages: BrainMessage[];
  requestContext?: BrainContext;
}): Promise<KaixuBrainResult> {
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
    api_token_locked_email: requestContext?.api_token_locked_email || null,
  };
  const payload = {
    provider,
    model,
    messages,
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
        request_id: primary.requestId,
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
      billing,
    };
  }

  let backup: AttemptResult | null = null;
  if (shouldUseBackup(primary.status, primary.error)) {
    backup = await callBackupBrain({
      ...payload,
      request_context: requestContext || {},
      brain_policy: {
        allow_backup: true,
        allow_user_direct: false,
      },
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
        request_id: backup.requestId,
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
      billing,
    };
  }

  const primaryMsg = primary.status
    ? `Kaixu gateway call failed (${primary.status})${primary.requestId ? ` [${primary.requestId}]` : ""}: ${primary.error}`
    : `Kaixu gateway call failed: ${primary.error}`;
  const backupMsg = backup
    ? ` Backup brain unavailable${backup.status ? ` (${backup.status})` : ""}${backup.requestId ? ` [${backup.requestId}]` : ""}: ${backup.error}`
    : "";

  return {
    ok: false,
    status: 502,
    error: `${primaryMsg}${backupMsg}`.trim(),
    brain: {
      route: backup ? "backup" : "primary",
      failed: true,
      provider,
      model,
      request_id: (backup?.requestId || primary.requestId) || null,
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
    usage: (backup?.usage || primary.usage),
    billing,
  };
}