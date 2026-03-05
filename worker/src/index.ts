/*
 * Entry point for the Cloudflare Worker.  This module wires up
 * HTTP routes using itty-router and delegates operations to
 * helper modules.  It implements: health checks, CORS
 * preflight responses, streaming downloads of evidence from R2,
 * vaulting Netlify tokens, exporting workspaces, pushing to
 * GitHub via GitHub App installations, triggering Netlify
 * deploys, and exporting evidence packs to R2 with signed
 * download URLs.
 */

import { router, corsHeaders, requireRunnerAuth } from "./router";
import { encryptToken, decryptToken, sha256Hex, hmacSigHex } from "./crypto";
import { q } from "./neon";
import { buildZip } from "./zip";
import { githubAppPushFromWorkspace } from "./github_app_push";
import { netlifyDeployFromWorkspace } from "./netlify";
import { makeSignedDownloadURL, verifySignedDownload } from "./r2_signed";
import { verifyAccessJwt } from "./access";

/**
 * Helper to return JSON responses.  Sets the Content-Type and
 * merges any additional headers (e.g. CORS).  Body is
 * stringified unless it's already a string.
 */
function j(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Cloudflare Workers don't guarantee Node's Buffer API.
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Read the request body into a string and parsed JSON.  Returns
 * an object with `text` and `json` properties.  If parsing
 * fails, `json` will be an empty object.  Always resolves.
 */
async function readBody(req: Request): Promise<{ text: string; json: any }> {
  const text = await req.text();
  let jsonData: any = {};
  try {
    jsonData = text ? JSON.parse(text) : {};
  } catch {
    jsonData = {};
  }
  return { text, json: jsonData };
}

// CORS preflight handler.  Always respond with 204 and CORS
router.options("*", (req: Request, env: any) => {
  return new Response(null, { status: 204, headers: corsHeaders(env, req) });
});

// Health check endpoint for monitoring
router.get("/health", (req: Request, env: any) => {
  return j({ ok: true, name: "kaixu-superide-runner" }, 200, corsHeaders(env, req));
});

// Download endpoint for streaming evidence from R2.  The signed
// URL includes the object key, expiration and signature.  This
// handler verifies the signature and expiry before streaming the
// object.  If verification fails, a 401 or 404 is returned.
router.get("/download", async (req: Request, env: any) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const exp = Number(url.searchParams.get("exp") || "0");
  const sig = url.searchParams.get("sig") || "";
  const signingKey = env.EVIDENCE_SIGNING_KEY;
  if (!signingKey) return new Response("Missing EVIDENCE_SIGNING_KEY", { status: 500 });
  const ok = await verifySignedDownload(String(signingKey), key, exp, sig);
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const obj = await env.KX_EVIDENCE_R2.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/zip",
      "Content-Disposition": `attachment; filename="${key.split("/").pop() || "evidence.zip"}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
});

// Vault a Netlify token for a user.  The token is encrypted with
// AES-GCM using the NETLIFY_TOKEN_MASTER_KEY and stored in KV.
// Only the runner can decrypt it.  The request must be
// authenticated via the runner signature.  Body must include
// user_id and token.  Optionally other fields may be passed but
// are ignored here.
router.post("/v1/vault/netlify/store", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/vault/netlify/store", text);
  const user_id = body.user_id;
  const token = body.token;
  if (!user_id || !token) return j({ error: "Missing user_id/token." }, 400, corsHeaders(env, req));
  const master = env.NETLIFY_TOKEN_MASTER_KEY;
  if (!master) throw new Error("Missing NETLIFY_TOKEN_MASTER_KEY.");
  const enc = await encryptToken(String(master), String(token));
  await env.KX_SECRETS_KV.put(`netlify:${user_id}`, JSON.stringify(enc));
  return j({ ok: true }, 200, corsHeaders(env, req));
});

// Export workspace as a ZIP archive.  The request must be
// authenticated via HMAC signature.  The body should include
// user_id, org_id and ws_id.  The function verifies that the
// workspace belongs to the org_id before exporting.  Returns
// filename, base64 encoded ZIP and byte size.
router.post("/v1/ws/export", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/ws/export", text);
  const { user_id, org_id, ws_id } = body;
  if (!user_id || !org_id || !ws_id) return j({ error: "Missing user_id/org_id/ws_id." }, 400, corsHeaders(env, req));
  const ws = await q(env, "select org_id, files_json from workspaces where id=$1", [ws_id]);
  if (!ws.rows.length) return j({ error: "Workspace not found." }, 404, corsHeaders(env, req));
  if (ws.rows[0].org_id !== org_id) return j({ error: "Forbidden." }, 403, corsHeaders(env, req));
  const files: { path: string; content: string }[] = ws.rows[0].files_json || [];
  const zipBytes = buildZip(Object.fromEntries(files.map(f => [f.path, f.content ?? ""])));
  const b64 = bytesToBase64(zipBytes);
  return j(
    {
      filename: `workspace-${ws_id.slice(0, 8)}.zip`,
      base64: b64,
      bytes: zipBytes.length,
    },
    200,
    corsHeaders(env, req)
  );
});

// Push a workspace to GitHub via GitHub App installation.  The
// body must include org_id, ws_id, repo, branch and installation_id.
// The message is optional; a default will be used if omitted.
router.post("/v1/github/app/push", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/github/app/push", text);
  const { user_id, org_id, ws_id, repo, branch, installation_id, message } = body;
  if (!user_id || !org_id || !ws_id || !repo || !installation_id) return j({ error: "Missing fields." }, 400, corsHeaders(env, req));
  // Guard: ensure the workspace belongs to the org
  const ws = await q(env, "select org_id from workspaces where id=$1", [ws_id]);
  if (!ws.rows.length) return j({ error: "Workspace not found." }, 404, corsHeaders(env, req));
  if (ws.rows[0].org_id !== org_id) return j({ error: "Forbidden." }, 403, corsHeaders(env, req));
  try {
    const out = await githubAppPushFromWorkspace(env, Number(installation_id), String(ws_id), String(repo), String(branch || "main"), String(message || "kAIxU update"));
    return j(out, 200, corsHeaders(env, req));
  } catch (e: any) {
    return j({ error: e?.message || "GitHub push failed." }, 500, corsHeaders(env, req));
  }
});

// Trigger a Netlify deploy for a workspace.  The body must include
// user_id, org_id, ws_id and site_id.  Title is optional.  Uses
// the vaulted token stored in KV.  The workspace must belong to
// the org.  Returns deploy details on success.
router.post("/v1/netlify/deploy", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/netlify/deploy", text);
  const { user_id, org_id, ws_id, site_id, title } = body;
  if (!user_id || !org_id || !ws_id || !site_id) return j({ error: "Missing fields." }, 400, corsHeaders(env, req));
  const raw = await env.KX_SECRETS_KV.get(`netlify:${user_id}`);
  if (!raw) return j({ error: "Netlify not vaulted for user." }, 400, corsHeaders(env, req));
  const master = env.NETLIFY_TOKEN_MASTER_KEY;
  if (!master) throw new Error("Missing NETLIFY_TOKEN_MASTER_KEY.");
  const token = await decryptToken(String(master), JSON.parse(raw));
  // org guard
  const ws = await q(env, "select org_id from workspaces where id=$1", [ws_id]);
  if (!ws.rows.length) return j({ error: "Workspace not found." }, 404, corsHeaders(env, req));
  if (ws.rows[0].org_id !== org_id) return j({ error: "Forbidden." }, 403, corsHeaders(env, req));
  try {
    const out = await netlifyDeployFromWorkspace(env, String(token), String(ws_id), String(site_id), String(title || "kAIxU deploy"));
    return j(out, 200, corsHeaders(env, req));
  } catch (e: any) {
    return j({ error: e?.message || "Netlify deploy failed." }, 500, corsHeaders(env, req));
  }
});

// Export an evidence pack to R2 with a signed download URL.  The
// body must include org_id; ws_id is optional.  The runner
// verifies that the caller is authorized via signature.  The
// exported pack contains manifest.json, audit-events.json and
// workspace.json.  A manifest hash is signed with the
// EVIDENCE_SIGNING_KEY.  The object is stored in R2 and a signed
// URL valid for 15 minutes is returned.
router.post("/v1/evidence/r2/export", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/evidence/r2/export", text);
  const { org_id, ws_id } = body;
  if (!org_id) return j({ error: "Missing org_id." }, 400, corsHeaders(env, req));
  const signingKey = env.EVIDENCE_SIGNING_KEY;
  if (!signingKey) throw new Error("Missing EVIDENCE_SIGNING_KEY.");
  // Fetch audit events (limit 8000) and workspace if provided
  const events = await q(env, "select at,actor,org_id,ws_id,type,meta from audit_events where org_id=$1 and ($2::uuid is null or ws_id=$2::uuid) order by at desc limit 8000", [org_id, ws_id || null]);
  const ws = ws_id ? await q(env, "select id,name,updated_at,files_json from workspaces where id=$1", [ws_id]) : { rows: [] as any[] };
  const manifest = {
    product: "kAIxU Super IDE vNext",
    exported_at: new Date().toISOString(),
    org_id,
    ws_id: ws_id || null,
    counts: {
      audit_events: events.rows.length,
      workspace_files: ws.rows[0]?.files_json?.length || 0,
    },
    integrity: {
      scheme: "HMAC-SHA256(manifest_sha256)",
      signer: "KX Evidence Key",
    },
  };
  const auditJson = JSON.stringify({ events: events.rows }, null, 2);
  const wsJson = JSON.stringify({ workspace: ws.rows[0] || null }, null, 2);
  const manifestJson = JSON.stringify(manifest, null, 2);
  const zipBytes = buildZip({
    "manifest.json": manifestJson,
    "audit-events.json": auditJson,
    "workspace.json": wsJson,
  });
  const manifestSha = await sha256Hex(new TextEncoder().encode(manifestJson));
  const signature = await hmacSigHex(String(signingKey), manifestSha);
  const key = `evidence/${org_id}/${ws_id || "org"}/${Date.now()}-evidence.zip`;
  await env.KX_EVIDENCE_R2.put(key, zipBytes, { httpMetadata: { contentType: "application/zip" } });
  const expiresUnix = Math.floor(Date.now() / 1000) + 15 * 60;
  const url = await makeSignedDownloadURL(req.url, String(signingKey), key, expiresUnix);
  return j(
    {
      ok: true,
      filename: key.split("/").pop(),
      bytes: zipBytes.length,
      url,
      manifest_sha256: manifestSha,
      signature,
      expires_at: new Date(expiresUnix * 1000).toISOString(),
    },
    200,
    corsHeaders(env, req)
  );
});

// Explicit fallback for unmatched routes.
router.all("*", (req: Request, env: any) => {
  return j({ error: "Not found." }, 404, corsHeaders(env, req));
});

// Default export: dispatch requests through the router and handle
// unexpected errors.  Always set CORS headers on success and
// error responses where appropriate.
export default {
  async fetch(req: Request, env: any): Promise<Response> {
    try {
      if (env.ACCESS_AUD && req.method !== "OPTIONS") {
        const ok = await verifyAccessJwt(req, env);
        if (!ok) {
          return j({ error: "Unauthorized (Cloudflare Access JWT invalid)." }, 401, corsHeaders(env, req));
        }
      }
      return await router.fetch(req, env);
    } catch (e: any) {
      // On error, return JSON with the error message.  Do not
      // disclose secrets.  Attach CORS headers if available.
      const headers = corsHeaders(env, req);
      return j({ error: e?.message || "Runner failure." }, 500, headers);
    }
  },
};