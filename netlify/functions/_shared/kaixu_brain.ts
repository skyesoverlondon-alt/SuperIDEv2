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
};

type AttemptResult = {
  ok: boolean;
  status: number | null;
  text: string;
  error: string;
  detail: string | null;
  requestId: string | null;
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

function shouldUseBackup(status: number | null, error: string): boolean {
  if (error) return true;
  if (status == null) return true;
  return status === 429 || status >= 500;
}

async function callPrimaryBrain(endpoint: string, token: string, payload: Record<string, unknown>): Promise<AttemptResult> {
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
    if (res.ok && reply) {
      return {
        ok: true,
        status: res.status,
        text: reply,
        error: "",
        detail: null,
        requestId,
      };
    }
    return {
      ok: false,
      status: res.status,
      text: "",
      error: compactErrorMessage(data, text),
      detail: text.slice(0, 2000) || null,
      requestId,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: null,
      text: "",
      error: String(e?.message || "Primary brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
      detail: null,
      requestId: null,
    };
  }
}

async function callBackupBrain(payload: Record<string, unknown>): Promise<AttemptResult> {
  try {
    const { status, data } = await runnerCallDetailed<any>("/v1/brain/backup/generate", payload);
    const requestId = String(data?.brain?.request_id || "").trim() || null;
    const reply = extractReply(data, "");
    if (status >= 200 && status < 300 && reply) {
      return {
        ok: true,
        status,
        text: reply,
        error: "",
        detail: null,
        requestId,
      };
    }
    return {
      ok: false,
      status,
      text: "",
      error: compactErrorMessage(data, ""),
      detail: JSON.stringify(data || {}).slice(0, 2000) || null,
      requestId,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: null,
      text: "",
      error: String(e?.message || "Backup brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
      detail: null,
      requestId: null,
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
  const payload = {
    provider,
    model,
    messages,
  };

  const primary = await callPrimaryBrain(endpoint, token, payload);
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
    });
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
  };
}