import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { must, opt } from "./_shared/env";
import { filterSknoreFiles, isSknoreProtected, loadSknorePolicy } from "./_shared/sknore";
import { audit } from "./_shared/audit";
import { hasValidMasterSequence, readBearerToken, resolveApiToken, tokenHasScope } from "./_shared/api_tokens";

/**
 * Call the Kaixu Gateway to generate a response for the given prompt.
 * The active file, full workspace snapshot and user prompt are
 * packaged into the system and user messages.  The gateway
 * endpoint and application token are sourced from environment
 * variables.  All calls are audited.
 */
export const handler = async (event: any) => {
  const u = await requireUser(event);
  const bearer = readBearerToken(event.headers || {});
  const tokenPrincipal = bearer ? await resolveApiToken(bearer) : null;
  if (!u && !tokenPrincipal) return forbid();

  const headers = event.headers || {};
  const tokenEmailHeader =
    String(headers["x-token-email"] || headers["X-Token-Email"] || "").trim().toLowerCase();
  const tokenMasterHeader =
    String(headers["x-token-master-sequence"] || headers["X-Token-Master-Sequence"] || "").trim();
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

  const actorEmail = u?.email || `token:${tokenPrincipal?.prefix || "unknown"}`;
  const actorOrg = u?.org_id || tokenPrincipal?.org_id || null;
  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }
  const ws_id: string | undefined = body.ws_id;
  const activePath: string | undefined = body.activePath;
  const files: any[] | undefined = body.files;
  const prompt: string | undefined = body.prompt;
  if (!ws_id || !prompt) {
    return json(400, { error: "Missing ws_id or prompt." });
  }

  const sknorePatterns = await loadSknorePolicy(actorOrg as string, ws_id || null);
  if (activePath && isSknoreProtected(activePath, sknorePatterns)) {
    await audit(actorEmail, actorOrg, ws_id, "sknore.blocked.active_path", {
      activePath,
      patterns_count: sknorePatterns.length,
    });
    return json(403, {
      error: `SKNore policy blocks active file: ${activePath}`,
      code: "SKNORE_BLOCKED_ACTIVE_PATH",
    });
  }

  const safeFiles = filterSknoreFiles((files || []) as Array<{ path: string }>, sknorePatterns);
  if ((files || []).length !== safeFiles.length) {
    await audit(actorEmail, actorOrg, ws_id, "sknore.blocked.files", {
      requested_files: (files || []).length,
      allowed_files: safeFiles.length,
      patterns_count: sknorePatterns.length,
    });
  }
  const endpoint = must("KAIXU_GATEWAY_ENDPOINT");
  const token = must("KAIXU_APP_TOKEN");
  // Emit audit before calling the model
  await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.requested", {
    activePath: activePath || null,
    filesLength: safeFiles.length,
  });
  const payload = {
    model: "kAIxU-Prime6.7",
    messages: [
      {
        role: "system",
        content:
          "You are kAIxU inside Super IDE. Enforce plan-first. Output concise steps and patches. Speak directly to the user.",
      },
      {
        role: "user",
        content: `Active file: ${activePath || ""}\n\nUser prompt:\n${prompt}\n\nWorkspace snapshot:\n${JSON.stringify(
          safeFiles || []
        ).slice(0, 120000)}`,
      },
    ],
  };
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
    if (!res.ok) {
      await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.failed", {
        status: res.status,
        body: text.slice(0, 2000),
      });
      const gatewayMsg =
        (typeof data?.error === "string" && data.error) ||
        (typeof data?.message === "string" && data.message) ||
        (typeof data?.raw === "string" && data.raw) ||
        text ||
        "Gateway returned non-OK response.";
      return json(502, {
        error: "Kaixu gateway call failed.",
        gateway_status: res.status,
        gateway_detail: String(gatewayMsg).slice(0, 400),
      });
    }
    const reply =
      data?.text || data?.output || data?.choices?.[0]?.message?.content || text;
    await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.ok", {
      out_chars: (reply || "").length,
    });
    return json(200, { text: reply });
  } catch (e: any) {
    const err = e?.message || "Kaixu call failed.";
    await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.failed", {
      error: err,
    });
    return json(502, { error: err });
  }
};