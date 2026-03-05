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

  let aiReply = "";
  let lastStatus = 0;
  let lastBody = "";
  let lastErr = "";

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
      user_record_id: userRow.rows[0]?.id || null,
      gateway_status: lastStatus || null,
      gateway_error: lastErr || null,
      gateway_body: lastBody || null,
    });
    return json(502, {
      error: "kAIxU gateway failed for chat.",
      gateway_status: lastStatus || null,
      gateway_error: lastErr || null,
      gateway_detail: (lastBody || "").slice(0, 400) || null,
    });
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

  await audit(u.email, u.org_id, wsId || null, "skychat.kaixu.ok", {
    channel,
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
