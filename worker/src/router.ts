/*
 * Router and cross‑cutting helpers for the Cloudflare Worker.
 * Uses itty-router for declarative route definitions and
 * includes middleware to enforce CORS and authenticate calls
 * from Netlify Functions via HMAC signatures.  See README for
 * details on the signature scheme.
 */

import { Router } from "itty-router";
import { verifyRunnerSig } from "./crypto";

/**
 * Construct CORS headers for the given request.  Allowed origins
 * are specified via the ALLOW_ORIGINS environment variable on
 * the Worker.  Multiple origins may be comma separated.  If the
 * request origin matches one of the allowed origins the same
 * origin is echoed back; otherwise the first allowed origin (or
 * empty string) is used.  Credentials, headers and methods are
 * permissive but may be tightened if necessary.
 */
export function corsHeaders(env: any, req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOW_ORIGINS || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-KX-TS, X-KX-SIG",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}

/**
 * Verify the HMAC signature on a Netlify Function call.  The
 * signature is computed over the timestamp, path and body and is
 * passed in the X-KX-SIG header.  This helper throws on failure
 * or if the shared secret is missing.  The caller should catch
 * errors and return an appropriate response.
 */
export async function requireRunnerAuth(env: any, req: Request, path: string, body: string): Promise<void> {
  const secret = env.RUNNER_SHARED_SECRET;
  if (!secret) throw new Error("Missing RUNNER_SHARED_SECRET in Worker secrets.");
  const ok = await verifyRunnerSig(req, secret, path, body);
  if (!ok) throw new Error("Unauthorized (runner signature)");
}

/**
 * Instantiate a new itty-router.  Exported so that other modules
 * can register routes on this instance.  The default export in
 * index.ts uses this router.
 */
export const router = Router();