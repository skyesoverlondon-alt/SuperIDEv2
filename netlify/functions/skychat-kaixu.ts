import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { must, opt } from "./_shared/env";
import {
  canPostToChannel,
  ensureCoreSkychatChannels,
  getOrgRole,
  resolveAccessibleChannel,
} from "./_shared/skychat";

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

async function tokenFingerprint(token: string): Promise<string> {
  const normalized = String(token || "").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 4)}...len=${normalized.length} sha256=${hex.slice(0, 12)}`;
}

function resolveKaixuGatewayProvider(raw: string): string {
  const value = String(raw || "").trim();
  return value || "Skyes Over London";
}

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

  const endpoint = normalizeKaixuGatewayEndpoint(must("KAIXU_GATEWAY_ENDPOINT"));
  const token = must("KAIXU_APP_TOKEN");
  const tokenFp = await tokenFingerprint(token);
  const providerRaw = opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London");
  const provider = resolveKaixuGatewayProvider(providerRaw);
  const modelRaw = opt("KAIXU_GATEWAY_MODEL", "kAIxU-Prime6.7");
  const model = String(body.model || modelRaw || "kAIxU-Prime6.7").trim();
  const prompt = [
    `Channel: #${channel}`,
    `Channel Type: ${channelInfo.kind}`,
    `User: ${u.email}`,
    `Message: ${message}`,
    recentContext.length ? `Recent Context:\n${recentContext.join("\n")}` : "Recent Context: none",
    "Respond as kAIxU assistant in concise team-chat style.",
  ].join("\n");

  const payload = {
    provider,
    model,
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

  let aiReply = "";
  let lastStatus = 0;
  let lastBody = "";
  let lastErr = "";
  let lastRequestId = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
      lastStatus = res.status;
      lastBody = text.slice(0, 2000);
      lastRequestId = String(res.headers.get("x-kaixu-request-id") || "").trim();

      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }

      const candidate = String(data?.text || data?.output || data?.choices?.[0]?.message?.content || text || "").trim();
      if (res.ok && candidate) {
        aiReply = candidate;
        break;
      }
    } catch (e: any) {
      lastErr = e?.message || "Gateway call failed.";
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (!aiReply) {
    await audit(u.email, u.org_id, wsId || null, "skychat.kaixu.failed", {
      channel,
      channel_kind: channelInfo.kind,
      user_record_id: userRow.rows[0]?.id || null,
      gateway_status: lastStatus || null,
      gateway_error: lastErr || null,
      gateway_body: lastBody || null,
      gateway_request_id: lastRequestId || null,
      token_fingerprint: tokenFp,
      configured_provider: providerRaw,
      effective_provider: provider,
      effective_model: model,
    });
    return json(502, {
      error: "kAIxU gateway failed for chat.",
      gateway_endpoint: endpoint,
      gateway_status: lastStatus || null,
      gateway_error: lastErr || null,
      gateway_request_id: lastRequestId || null,
      token_fingerprint: tokenFp,
      configured_provider: providerRaw,
      effective_provider: provider,
      effective_model: model,
      gateway_detail: (lastBody || "").slice(0, 400) || null,
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
        message: aiReply,
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
  });

  return json(200, {
    ok: true,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    ai_message: aiReply,
    created_at: aiRow.rows[0]?.created_at || null,
  });
};
