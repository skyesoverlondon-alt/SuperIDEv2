import { must } from "./env";
import crypto from "crypto";

/**
 * Invoke a worker endpoint with HMAC authenticated payload.  The
 * timestamp, path and body are concatenated and signed with
 * RUNNER_SHARED_SECRET.  The WORKER_RUNNER_URL env var must point
 * at the deployed Worker.  Returns the parsed JSON response.
 */
export async function runnerCall<T>(path: string, payload: any): Promise<T> {
  const { status, data } = await runnerCallDetailed<T>(path, payload);
  if (status < 200 || status >= 300) {
    throw new Error((data as any)?.error || `Runner error (${status})`);
  }
  return data as T;
}

export async function runnerCallDetailed<T>(path: string, payload: any): Promise<{ status: number; data: T; headers: Headers }> {
  const base = must("WORKER_RUNNER_URL").replace(/\/+$/g, "");
  const secret = must("RUNNER_SHARED_SECRET");
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  const ts = Date.now().toString();
  const body = JSON.stringify(payload ?? {});
  const canonical = `${ts}\n${path}\n${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(canonical);
  const sig = hmac.digest("base64url");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-KX-TS": ts,
    "X-KX-SIG": sig,
  };
  if (accessClientId && accessClientSecret) {
    headers["CF-Access-Client-Id"] = accessClientId;
    headers["CF-Access-Client-Secret"] = accessClientSecret;
  }
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return {
    status: res.status,
    data: data as T,
    headers: res.headers,
  };
}