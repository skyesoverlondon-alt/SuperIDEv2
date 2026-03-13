import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { opt } from "./_shared/env";
import {
  canPostToChannel,
  ensureCoreSkychatChannels,
  getOrgRole,
  resolveAccessibleChannel,
} from "./_shared/skychat";
import { callKaixuBrainWithFailover } from "./_shared/kaixu_brain";
import { recordBrainUsage } from "./_shared/brain_usage";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const channel = String(body.channel || "community").trim();
  const message = String(body.message || "").trim();
  const wsId = String(body.ws_id || "").trim();
  if (!channel || !message) {
    return json(400, { error: "Missing channel or message." });
  }

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  const channelInfo = await resolveAccessibleChannel(u.org_id, u.user_id, orgRole, channel);
  if (!channelInfo) return json(403, { error: "Channel access denied." });
  const canPost = await canPostToChannel(u.org_id, u.user_id, orgRole, channelInfo);
  if (!canPost) return json(403, { error: "Posting denied for this channel." });
  const effectiveWsId = channelInfo.kind === "group" ? (wsId || null) : null;

  const userRow = await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id",
    [
      u.org_id,
      effectiveWsId,
      "SkyeChat",
      `#${channelInfo.slug}`,
      JSON.stringify({
        channel: channelInfo.slug,
        channel_slug: channelInfo.slug,
        channel_id: channelInfo.id,
        channel_kind: channelInfo.kind,
        message,
        source: "SkyeChat user",
        role: "user",
      }),
      u.user_id,
    ]
  );

  const contextRows = await q(
    `select payload
     from app_records
     where org_id=$1
       and app='SkyeChat'
       and lower(coalesce(payload->>'channel_slug', payload->>'channel',''))=$2
     order by created_at desc
     limit 10`,
    [u.org_id, channelInfo.slug]
  );

  const recentContext = contextRows.rows
    .map((row) => {
      const p = row?.payload && typeof row.payload === "object" ? row.payload : {};
      const src = String(p.source || "user").slice(0, 48);
      const msg = String(p.message || "").replace(/\s+/g, " ").slice(0, 240);
      return `${src}: ${msg}`;
    })
    .filter(Boolean)
    .reverse();

  const providerRaw = opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London");
  const modelRaw = opt("KAIXU_GATEWAY_MODEL", "kAIxU-Prime6.7");
  const prompt = [
    `Channel: #${channel}`,
    `Channel Type: ${channelInfo.kind}`,
    `User: ${u.email}`,
    `Message: ${message}`,
    recentContext.length ? `Recent Context:\n${recentContext.join("\n")}` : "Recent Context: none",
    "Respond as kAIxU assistant in concise team-chat style.",
  ].join("\n");

  const payload = {
    messages: [
      {
        role: "system",
        content: "You are kAIxU collaborating in SkyeChat. Keep responses concise, useful, and execution-oriented.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  const result = await callKaixuBrainWithFailover({
    bodyModel: body.model,
    defaultModel: modelRaw,
    providerRaw,
    messages: payload.messages,
    requestContext: {
      ws_id: effectiveWsId,
      app: "SkyeChat",
      actor_email: u.email,
      actor_org: u.org_id,
      actor_user_id: u.user_id,
      auth_type: "session",
    },
  });

  if (!result.ok) {
    await audit(u.email, u.org_id, wsId || null, "skychat.kaixu.failed", {
      channel,
      channel_kind: channelInfo.kind,
      user_record_id: userRow.rows[0]?.id || null,
      gateway_status: result.gateway_status,
      gateway_error: result.error,
      gateway_body: result.gateway_detail,
      gateway_request_id: result.gateway_request_id,
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

  const aiRow = await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id, created_at",
    [
      u.org_id,
      effectiveWsId,
      "SkyeChat",
      `#${channelInfo.slug}`,
      JSON.stringify({
        channel: channelInfo.slug,
        channel_slug: channelInfo.slug,
        channel_id: channelInfo.id,
        channel_kind: channelInfo.kind,
        message: result.text,
        source: "kAIxU",
        role: "assistant",
      }),
      u.user_id,
    ]
  );

  await audit(u.email, u.org_id, effectiveWsId, "skychat.kaixu.ok", {
    channel: channelInfo.slug,
    channel_kind: channelInfo.kind,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    brain_route: result.brain.route,
    brain_request_id: result.brain.request_id,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing,
  });

  await recordBrainUsage({
    actor: u.email,
    actor_email: u.email,
    actor_user_id: u.user_id,
    org_id: u.org_id,
    ws_id: effectiveWsId,
    app: "SkyeChat",
    auth_type: "session",
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

  return json(200, {
    ok: true,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    ai_message: result.text,
    brain: result.brain,
    used_backup: result.used_backup,
    usage: result.usage,
    billing: result.billing,
    created_at: aiRow.rows[0]?.created_at || null,
  });
};
