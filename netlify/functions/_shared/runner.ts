import { must } from "./env";
import crypto from "crypto";

/**
 * Invoke a worker endpoint with HMAC authenticated payload.  The
 * timestamp, path and body are concatenated and signed with
 * RUNNER_SHARED_SECRET.  The WORKER_RUNNER_URL env var must point
 * at the deployed Worker.  Returns the parsed JSON response.
 */
export async function runnerCall<T>(path: string, payload: any): Promise<T> {
  const base = must("WORKER_RUNNER_URL").replace(/\/+$|\/+/g, "");
  const secret = must("RUNNER_SHARED_SECRET");
  const ts = Date.now().toString();
  const body = JSON.stringify(payload ?? {});
  const canonical = `${ts}\n${path}\n${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(canonical);
  const sig = hmac.digest("base64url");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KX-TS": ts,
      "X-KX-SIG": sig,
    },
    body,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || `Runner error (${res.status})`);
  }
  return data as T;
}