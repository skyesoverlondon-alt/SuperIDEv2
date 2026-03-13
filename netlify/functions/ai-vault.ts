import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { callKaixuBrainWithFailover } from "./_shared/kaixu_brain";
import { recordBrainUsage } from "./_shared/brain_usage";

export const handler = async (event: any) => {
  const user = await requireUser(event);
  if (!user) return forbid();

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const prompt = String(body.prompt || "").trim();
  const corpus = Array.isArray(body.corpus) ? body.corpus.slice(0, 80) : [];
  if (!prompt) return json(400, { error: "Prompt is required." });

  const modelRaw = "kAIxU-Prime6.7";
  const providerRaw = "Skyes Over London";
  const requestedModel = String(body.model || "").trim() || undefined;
  const actorEmail = String(user.email || "unknown").trim() || "unknown";
  const promptText = `User request:\n${prompt}\n\nVault corpus:\n${JSON.stringify(corpus, null, 2)}`;

  await audit(actorEmail, user.org_id, null, "vault.ai.requested", {
    corpus_items: corpus.length,
  });

  const result = await callKaixuBrainWithFailover({
    bodyModel: requestedModel,
    defaultModel: modelRaw,
    providerRaw,
    messages: [
      {
        role: "system",
        content:
          "You are helping a user search and reason over a personal file vault. Use only the supplied vault corpus. Be practical, concise, and cite file paths plainly when useful. If the corpus is insufficient, say so.",
      },
      {
        role: "user",
        content: promptText,
      },
    ],
    requestContext: {
      ws_id: null,
      activePath: null,
      app: "SkyeVault-Pro-v4.46",
      actor_email: actorEmail,
      actor_org: user.org_id || null,
      actor_user_id: user.user_id,
      auth_type: "session",
      api_token_id: null,
      api_token_label: null,
      api_token_locked_email: null,
    },
  });

  if (!result.ok) {
    await audit(actorEmail, user.org_id, null, "vault.ai.failed", {
      error: result.error,
      gateway_status: result.gateway_status,
      backup_status: result.backup_status,
      used_backup: result.used_backup,
      usage: result.usage,
      billing: result.billing,
    });
    return json(result.status, {
      ok: false,
      error: result.error,
      brain: result.brain,
      used_backup: result.used_backup,
      usage: result.usage,
      billing: result.billing,
    });
  }

  await recordBrainUsage({
    actor: actorEmail,
    actor_email: actorEmail,
    actor_user_id: user.user_id,
    org_id: user.org_id || null,
    ws_id: null,
    app: "SkyeVault-Pro-v4.46",
    auth_type: "session",
    api_token_id: null,
    api_token_label: null,
    api_token_locked_email: null,
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

  await audit(actorEmail, user.org_id, null, "vault.ai.ok", {
    used_backup: result.used_backup,
    brain_route: result.brain.route,
    usage: result.usage,
    billing: result.billing,
  });

  return json(200, {
    ok: true,
    model: result.effective_model,
    text: result.text,
    brain: result.brain,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing,
  });
};