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

function h(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

// Cloudflare Workers don't guarantee Node's Buffer API.
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function normalizeKaixuEndpoint(raw: string): string {
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

function compactBrainError(data: any, text: string): string {
  const msg =
    (typeof data?.error === "string" && data.error) ||
    (typeof data?.message === "string" && data.message) ||
    (typeof data?.raw === "string" && data.raw) ||
    text ||
    "Backup brain request failed.";
  return String(msg).replace(/\s+/g, " ").trim().slice(0, 220);
}

function extractBrainReply(data: any, text: string): string {
  return String(data?.text || data?.output || data?.choices?.[0]?.message?.content || text || "").trim();
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

router.post("/v1/brain/backup/generate", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/brain/backup/generate", text);

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) {
    return j({ ok: false, error: "Missing messages.", brain: { route: "backup", failed: true } }, 400, corsHeaders(env, req));
  }

  const endpoint = normalizeKaixuEndpoint(String(env.KAIXU_BACKUP_ENDPOINT || ""));
  if (!endpoint) {
    return j({ ok: false, error: "Backup brain not configured.", brain: { route: "backup", failed: true } }, 503, corsHeaders(env, req));
  }

  const token = String(env.KAIXU_APP_TOKEN || env.KAIXU_BACKUP_TOKEN || "").trim();
  if (!token) {
    return j({ ok: false, error: "Backup brain token not configured.", brain: { route: "backup", failed: true } }, 500, corsHeaders(env, req));
  }

  const provider = String(body?.provider || env.KAIXU_BACKUP_PROVIDER || env.KAIXU_GATEWAY_PROVIDER || "Skyes Over London Backup").trim() || "Skyes Over London Backup";
  const model = String(body?.model || env.KAIXU_BACKUP_MODEL || env.KAIXU_GATEWAY_MODEL || "kAIxU-Prime6.7").trim() || "kAIxU-Prime6.7";

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ provider, model, messages }),
    });
    const upstreamText = await upstream.text();
    let data: any = null;
    try {
      data = upstreamText ? JSON.parse(upstreamText) : null;
    } catch {
      data = { raw: upstreamText };
    }
    const requestId = String(upstream.headers.get("x-kaixu-request-id") || data?.brain?.request_id || "").trim() || null;
    const reply = extractBrainReply(data, upstreamText);
    if (!upstream.ok || !reply) {
      return j(
        {
          ok: false,
          error: `Backup brain failed (${upstream.status})${requestId ? ` [${requestId}]` : ""}: ${compactBrainError(data, upstreamText)}`,
          brain: { route: "backup", failed: true, provider, model, request_id: requestId },
        },
        502,
        corsHeaders(env, req)
      );
    }
    return j(
      {
        ok: true,
        text: reply,
        brain: { route: "backup", provider, model, request_id: requestId },
      },
      200,
      corsHeaders(env, req)
    );
  } catch (e: any) {
    return j(
      {
        ok: false,
        error: String(e?.message || "Backup brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
        brain: { route: "backup", failed: true, provider, model, request_id: null },
      },
      502,
      corsHeaders(env, req)
    );
  }
});

router.post("/v1/brain/backup/generate-stream", async (req: Request, env: any) => {
  const { text, json: body } = await readBody(req);
  await requireRunnerAuth(env, req, "/v1/brain/backup/generate-stream", text);

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) {
    return j({ ok: false, error: "Missing messages.", brain: { route: "backup", failed: true } }, 400, corsHeaders(env, req));
  }

  const endpoint = normalizeKaixuEndpoint(String(env.KAIXU_BACKUP_ENDPOINT || ""));
  if (!endpoint) {
    return j({ ok: false, error: "Backup brain not configured.", brain: { route: "backup", failed: true } }, 503, corsHeaders(env, req));
  }

  const token = String(env.KAIXU_APP_TOKEN || env.KAIXU_BACKUP_TOKEN || "").trim();
  if (!token) {
    return j({ ok: false, error: "Backup brain token not configured.", brain: { route: "backup", failed: true } }, 500, corsHeaders(env, req));
  }

  const provider = String(body?.provider || env.KAIXU_BACKUP_PROVIDER || env.KAIXU_GATEWAY_PROVIDER || "Skyes Over London Backup").trim() || "Skyes Over London Backup";
  const model = String(body?.model || env.KAIXU_BACKUP_MODEL || env.KAIXU_GATEWAY_MODEL || "kAIxU-Prime6.7").trim() || "kAIxU-Prime6.7";

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ provider, model, messages, stream: true }),
    });
    const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
    if (!upstream.ok || !contentType.includes("text/event-stream") || !upstream.body) {
      const upstreamText = await upstream.text();
      let data: any = null;
      try {
        data = upstreamText ? JSON.parse(upstreamText) : null;
      } catch {
        data = { raw: upstreamText };
      }
      return j(
        {
          ok: false,
          stream_supported: false,
          error: `Backup brain streaming unavailable (${upstream.status}): ${compactBrainError(data, upstreamText)}`,
          brain: { route: "backup", failed: true, provider, model, request_id: String(upstream.headers.get("x-kaixu-request-id") || "").trim() || null },
        },
        409,
        corsHeaders(env, req)
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(env, req),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: any) {
    return j(
      {
        ok: false,
        error: String(e?.message || "Backup brain request failed.").replace(/\s+/g, " ").trim().slice(0, 220),
        brain: { route: "backup", failed: true, provider, model, request_id: null },
      },
      502,
      corsHeaders(env, req)
    );
  }
});

// Public landing page: this worker is an API runner, not the app UI.
router.get("/", (req: Request, env: any) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>kAIxu SuperIDE Runner | SkyesSOL</title>
  <style>
    :root {
      --bg-deep: #0b0914;
      --bg-panel: rgba(20, 17, 36, 0.88);
      --border: rgba(138, 79, 255, 0.28);
      --text-main: #f7f7ff;
      --text-muted: #a8afc6;
      --purple: #8a4fff;
      --purple-soft: rgba(138, 79, 255, 0.16);
      --gold: #ffd700;
      --gold-soft: rgba(255, 215, 0, 0.12);
      --glow-purple: rgba(138, 79, 255, 0.34);
      --glow-gold: rgba(255, 215, 0, 0.34);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: "Inter", "Segoe UI", Arial, sans-serif;
      color: var(--text-main);
      background-color: var(--bg-deep);
      background-image:
        radial-gradient(circle at 12% 18%, rgba(138, 79, 255, 0.2) 0%, transparent 42%),
        radial-gradient(circle at 84% 10%, rgba(255, 215, 0, 0.12) 0%, transparent 36%),
        linear-gradient(180deg, #0a0812 0%, #0e0b1c 100%);
      min-height: 100vh;
      padding: 34px 18px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    main {
      width: 100%;
      max-width: 1020px;
      background: linear-gradient(180deg, rgba(28, 22, 52, 0.94) 0%, var(--bg-panel) 100%);
      border: 1px solid var(--border);
      border-radius: 22px;
      overflow: hidden;
      box-shadow: 0 26px 80px rgba(0, 0, 0, 0.45), 0 0 40px var(--glow-purple);
    }

    .hero {
      padding: 34px 30px 22px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(120deg, rgba(138, 79, 255, 0.14) 0%, rgba(255, 215, 0, 0.06) 100%);
      position: relative;
      overflow: hidden;
    }

    .hero::after {
      content: "";
      position: absolute;
      top: -130px;
      right: -80px;
      width: 320px;
      height: 320px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(255, 215, 0, 0.2) 0%, transparent 70%);
      pointer-events: none;
    }

    .badge {
      display: inline-block;
      margin-bottom: 14px;
      padding: 7px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 215, 0, 0.32);
      background: var(--gold-soft);
      color: var(--gold);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      box-shadow: 0 0 18px var(--glow-gold);
    }

    h1 {
      font-size: clamp(29px, 5.4vw, 48px);
      line-height: 1.02;
      letter-spacing: -0.02em;
      max-width: 760px;
      margin-bottom: 14px;
      text-shadow: 0 0 24px var(--glow-purple);
    }

    .sub {
      max-width: 760px;
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.55;
      margin-bottom: 22px;
    }

    .cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      border-radius: 10px;
      border: 1px solid transparent;
      font-size: 13px;
      font-weight: 700;
      padding: 10px 14px;
      transition: all 0.2s ease;
    }

    .btn-primary {
      background: var(--purple);
      border-color: var(--purple);
      color: #fff;
      box-shadow: 0 0 20px var(--glow-purple);
    }

    .btn-primary:hover {
      transform: translateY(-1px);
      background: #9b66ff;
    }

    .btn-ghost {
      background: rgba(255, 255, 255, 0.03);
      border-color: var(--border);
      color: var(--text-main);
    }

    .btn-ghost:hover {
      border-color: var(--gold);
      color: var(--gold);
      box-shadow: 0 0 15px var(--glow-gold);
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      padding: 20px;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      background: linear-gradient(180deg, rgba(20, 19, 33, 0.9) 0%, rgba(16, 15, 28, 0.9) 100%);
      min-height: 132px;
    }

    .card h2 {
      margin-bottom: 8px;
      font-size: 15px;
      color: var(--gold);
      letter-spacing: 0.02em;
    }

    .card p {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .card a {
      color: #9bd4ff;
      text-decoration: none;
      font-weight: 600;
    }

    .card a:hover { text-decoration: underline; }

    code {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px 7px;
      color: #efe7ff;
      font-size: 12px;
    }

    .footer {
      border-top: 1px solid var(--border);
      padding: 14px 20px 18px;
      color: #858cad;
      font-size: 11px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    @media (min-width: 760px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="badge">SkyesSOL Infrastructure Node</div>
      <h1>kAIxu SuperIDE Runner Is Online</h1>
      <p class="sub">
        This endpoint is the secure backend plane for kAIxu SuperIDE operations. It handles protected
        API workloads, evidence routing, and deployment automation. Product UI lives in the app surface,
        while this Worker powers the engine underneath.
      </p>
      <div class="cta-row">
        <a class="btn btn-primary" href="https://skyesol.netlify.app/kaixu/requestkaixuapikey" target="_blank" rel="noopener noreferrer">Request kAIxu Key</a>
        <a class="btn btn-ghost" href="https://skyesol.netlify.app/" target="_blank" rel="noopener noreferrer">Visit SkyesSOL</a>
      </div>
    </section>
    <div class="grid">
      <section class="card">
        <h2>Company</h2>
        <p>
          Built and operated by SkyesSOL.<br />
          Site: <a href="https://skyesol.netlify.app/" target="_blank" rel="noopener noreferrer">skyesol.netlify.app</a>
        </p>
      </section>
      <section class="card">
        <h2>Get Access</h2>
        <p>
          Platform access requires an approved kAIxu key.<br />
          Apply: <a href="https://skyesol.netlify.app/kaixu/requestkaixuapikey" target="_blank" rel="noopener noreferrer">Request kAIxu API Key</a>
        </p>
      </section>
      <section class="card">
        <h2>Health Probe</h2>
        <p>
          Operational status endpoint:
          <a href="/health"><code>/health</code></a>
        </p>
      </section>
      <section class="card">
        <h2>Security</h2>
        <p>
          Protected routes enforce Cloudflare Access JWT and runner signatures.
        </p>
      </section>
    </div>
    <div class="footer">kAIxu SuperIDE Runner • SkyesSOL Systems</div>
  </main>
</body>
</html>`;
  return h(html, 200, corsHeaders(env, req));
});

// Browser probes should never throw and should be cheap.
router.get("/favicon.ico", (req: Request, env: any) => {
  return new Response(null, { status: 204, headers: corsHeaders(env, req) });
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
      const path = new URL(req.url).pathname;
      const isPublicProbe = path === "/" || path === "/health" || path === "/favicon.ico";
      if (env.ACCESS_AUD && req.method !== "OPTIONS" && !isPublicProbe) {
        const ok = await verifyAccessJwt(req, env);
        if (!ok) {
          return j({ error: "Unauthorized (Cloudflare Access JWT invalid)." }, 401, corsHeaders(env, req));
        }
      }
      const out = await router.fetch(req, env);
      if (out instanceof Response) return out;
      return j({ error: "Not found." }, 404, corsHeaders(env, req));
    } catch (e: any) {
      // On error, return JSON with the error message.  Do not
      // disclose secrets.  Attach CORS headers if available.
      const headers = corsHeaders(env, req);
      return j({ error: e?.message || "Runner failure." }, 500, headers);
    }
  },
};