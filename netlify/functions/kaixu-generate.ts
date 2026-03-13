import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { opt } from "./_shared/env";
import { filterSknoreFiles, isSknoreProtected, loadSknorePolicy } from "./_shared/sknore";
import { audit } from "./_shared/audit";
import { hasValidMasterSequence, readBearerToken, resolveApiToken, tokenHasScope } from "./_shared/api_tokens";
import { callKaixuBrainWithFailover } from "./_shared/kaixu_brain";
import { recordBrainUsage } from "./_shared/brain_usage";

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
  const providerRaw = opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London");
  const modelRaw = opt("KAIXU_GATEWAY_MODEL", "kAIxU-Prime6.7");
  const provider = String(providerRaw || "Skyes Over London").trim() || "Skyes Over London";
  const model = String(body.model || modelRaw || "kAIxU-Prime6.7").trim() || "kAIxU-Prime6.7";
  // Emit audit before calling the model
  await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.requested", {
    activePath: activePath || null,
    filesLength: safeFiles.length,
  });
  const payload = {
    provider,
    model,
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
  const result = await callKaixuBrainWithFailover({
    bodyModel: body.model,
    defaultModel: modelRaw,
    providerRaw,
    messages: payload.messages,
    requestContext: {
      ws_id,
      activePath: activePath || null,
      app: "SuperIDE",
      actor_email: actorEmail,
      actor_org: actorOrg,
      actor_user_id: u?.user_id || null,
      auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
      api_token_id: tokenPrincipal?.id || null,
      api_token_label: tokenPrincipal?.label || null,
      api_token_locked_email: tokenPrincipal?.locked_email || tokenEmailHeader || null,
    },
  });
  if (!result.ok) {
    await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.failed", {
      error: result.error,
      gateway_status: result.gateway_status,
      gateway_request_id: result.gateway_request_id,
      gateway_detail: result.gateway_detail,
      backup_status: result.backup_status,
      backup_request_id: result.backup_request_id,
      backup_error: result.backup_error,
      token_fingerprint: result.token_fingerprint,
      configured_provider: result.configured_provider,
      effective_provider: result.effective_provider,
      effective_model: result.effective_model,
      brain_route: result.brain.route,
      usage: result.usage,
      billing: result.billing,
    });
    return json(result.status, {
      ok: false,
      error: result.error,
      brain: result.brain,
      gateway_endpoint: result.gateway_endpoint,
      gateway_status: result.gateway_status,
      gateway_request_id: result.gateway_request_id,
      gateway_detail: result.gateway_detail,
      backup_status: result.backup_status,
      backup_request_id: result.backup_request_id,
      backup_detail: result.backup_detail,
      backup_error: result.backup_error,
      token_fingerprint: result.token_fingerprint,
      configured_provider: result.configured_provider,
      effective_provider: result.effective_provider,
      effective_model: result.effective_model,
      usage: result.usage,
      billing: result.billing,
    });
  }
  await recordBrainUsage({
    actor: actorEmail,
    actor_email: actorEmail,
    actor_user_id: u?.user_id || null,
    org_id: actorOrg,
    ws_id,
    app: "SuperIDE",
    auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
    api_token_id: tokenPrincipal?.id || null,
    api_token_label: tokenPrincipal?.label || null,
    api_token_locked_email: tokenPrincipal?.locked_email || tokenEmailHeader || null,
    used_backup: result.used_backup,
    brain_route: result.brain.route,
    provider: result.effective_provider,
    model: result.effective_model,
    gateway_request_id: result.gateway_request_id,
    backup_request_id: result.backup_request_id,
    gateway_status: result.gateway_status,
    backup_status: result.backup_status,
    usage: result.usage,
    billing: result.billing,
    success: true,
  });
  await audit(actorEmail, actorOrg, ws_id, "kaixu.generate.ok", {
    out_chars: result.text.length,
    brain_route: result.brain.route,
    brain_request_id: result.brain.request_id,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing,
  });
  return json(200, { ok: true, text: result.text, brain: result.brain, used_backup: result.used_backup, usage: result.usage, billing: result.billing });
};