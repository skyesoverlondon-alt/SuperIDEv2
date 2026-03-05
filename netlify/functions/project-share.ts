import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { sendMail } from "./_shared/mailer";
import { canReadWorkspace } from "./_shared/rbac";

type ShareMode = "mail" | "chat" | "app" | "all";

function normalizeShareMode(raw: string): ShareMode {
  const mode = raw.toLowerCase();
  if (mode === "mail" || mode === "chat" || mode === "app" || mode === "all") return mode;
  return "app";
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

  const wsId = String(body.ws_id || "").trim();
  const mode = normalizeShareMode(String(body.mode || "app"));
  const recipientEmail = String(body.recipient_email || "").trim().toLowerCase();
  const channel = String(body.channel || "general").trim();
  const note = String(body.note || "").trim();

  if (!wsId) return json(400, { error: "Missing ws_id." });

  const ws = await q(
    "select id, org_id, name, updated_at from workspaces where id=$1",
    [wsId]
  );
  if (!ws.rows.length) return json(404, { error: "Workspace not found." });
  if (ws.rows[0].org_id !== u.org_id) return json(403, { error: "Forbidden." });
  const canRead = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!canRead) return json(403, { error: "Workspace access denied." });

  const wsName = String(ws.rows[0].name || "workspace");
  const wsUpdated = String(ws.rows[0].updated_at || "");
  const baseMessage = [
    `Project share from ${u.email}`,
    `Workspace: ${wsName} (${wsId})`,
    wsUpdated ? `Updated: ${wsUpdated}` : null,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join("\n");

  const operations = {
    app_record_id: null as string | null,
    chat_record_id: null as string | null,
    mail_provider_id: null as string | null,
  };

  await q(
    "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id",
    [
      u.org_id,
      wsId,
      "SkyeDrive",
      `Shared workspace: ${wsName}`,
      JSON.stringify({ mode, by: u.email, ws_id: wsId, note }),
      u.user_id,
    ]
  ).then((r) => {
    operations.app_record_id = r.rows[0]?.id || null;
  });

  if (mode === "chat" || mode === "all") {
    const chat = await q(
      "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id",
      [
        u.org_id,
        wsId,
        "SkyeChat",
        `#${channel}`,
        JSON.stringify({ channel, message: baseMessage, source: "project-share" }),
        u.user_id,
      ]
    );
    operations.chat_record_id = chat.rows[0]?.id || null;
  }

  if (mode === "mail" || mode === "all") {
    if (!recipientEmail) return json(400, { error: "recipient_email is required for mail/all share mode." });
    const delivered = await sendMail({
      to: recipientEmail,
      subject: `Shared project: ${wsName}`,
      text: baseMessage,
    });
    await q(
      "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6)",
      [
        u.org_id,
        wsId,
        "SkyeMail",
        `Shared project: ${wsName}`,
        JSON.stringify({ to: recipientEmail, subject: `Shared project: ${wsName}`, text: baseMessage, provider: delivered.provider, provider_id: delivered.id }),
        u.user_id,
      ]
    );
    operations.mail_provider_id = delivered.id;
  }

  await audit(u.email, u.org_id, wsId, "project.share", {
    mode,
    recipient_email: recipientEmail || null,
    channel,
    has_note: Boolean(note),
    ...operations,
  });

  return json(200, {
    ok: true,
    mode,
    workspace: { id: wsId, name: wsName },
    ...operations,
  });
};
