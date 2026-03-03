import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { must } from "./_shared/env";
import { audit } from "./_shared/audit";

/**
 * Call the Kaixu Gateway to generate a response for the given prompt.
 * The active file, full workspace snapshot and user prompt are
 * packaged into the system and user messages.  The gateway
 * endpoint and application token are sourced from environment
 * variables.  All calls are audited.
 */
export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
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
  const endpoint = must("KAIXU_GATEWAY_ENDPOINT");
  const token = must("KAIXU_APP_TOKEN");
  // Emit audit before calling the model
  await audit(u.email, u.org_id, ws_id, "kaixu.generate.requested", {
    activePath: activePath || null,
    filesLength: (files || []).length,
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
          files || []
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
      await audit(u.email, u.org_id, ws_id, "kaixu.generate.failed", {
        status: res.status,
        body: text.slice(0, 2000),
      });
      return json(500, { error: "Kaixu gateway call failed." });
    }
    const reply =
      data?.text || data?.output || data?.choices?.[0]?.message?.content || text;
    await audit(u.email, u.org_id, ws_id, "kaixu.generate.ok", {
      out_chars: (reply || "").length,
    });
    return json(200, { text: reply });
  } catch (e: any) {
    const err = e?.message || "Kaixu call failed.";
    await audit(u.email, u.org_id, ws_id, "kaixu.generate.failed", {
      error: err,
    });
    return json(500, { error: err });
  }
};