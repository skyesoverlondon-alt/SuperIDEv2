import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { must } from "./_shared/env";

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

  const channel = String(body.channel || "general").trim();
  const message = String(body.message || "").trim();
  const wsId = String(body.ws_id || "").trim();
  if (!channel || !message) {
    return json(400, { error: "Missing channel or message." });
  }

  const userRow = await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id",
    [
      u.org_id,
      wsId || null,
      "SkyeChat",
      `#${channel}`,
      JSON.stringify({ channel, message, source: "SkyeChat user", role: "user" }),
      u.user_id,
    ]
  );

  const endpoint = must("KAIXU_GATEWAY_ENDPOINT");
  const token = must("KAIXU_APP_TOKEN");
  const prompt = [
    `Channel: #${channel}`,
    `User: ${u.email}`,
    `Message: ${message}`,
    "Respond as kAIxU assistant in concise team-chat style.",
  ].join("\n");

  let aiReply = "";
  let degraded = false;
  try {
    const payload = {
      model: "kAIxU-Prime6.7",
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
      degraded = true;
      aiReply = [
        "kAIxU gateway is temporarily unavailable.",
        "Captured your message and queued a fallback assistant response so channel workflow is not blocked.",
        `Action: retry shortly with context: ${message.slice(0, 180)}`,
      ].join(" ");
    } else {
      aiReply = String(data?.text || data?.output || data?.choices?.[0]?.message?.content || text || "").trim();
    }
  } catch (e: any) {
    degraded = true;
    aiReply = [
      "kAIxU chat request failed at the gateway boundary.",
      "Your message was still recorded.",
      "Action: retry once gateway connectivity is restored.",
    ].join(" ");
  }

  const aiRow = await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id, created_at",
    [
      u.org_id,
      wsId || null,
      "SkyeChat",
      `#${channel}`,
      JSON.stringify({ channel, message: aiReply, source: "kAIxU", role: "assistant" }),
      u.user_id,
    ]
  );

  await audit(u.email, u.org_id, wsId || null, degraded ? "skychat.kaixu.degraded" : "skychat.kaixu.ok", {
    channel,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    degraded,
  });

  return json(200, {
    ok: true,
    degraded,
    user_record_id: userRow.rows[0]?.id || null,
    ai_record_id: aiRow.rows[0]?.id || null,
    ai_message: aiReply,
    created_at: aiRow.rows[0]?.created_at || null,
  });
};
