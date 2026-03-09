import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { sendMail } from "./_shared/mailer";
import { canReadWorkspace } from "./_shared/rbac";
import { readIdempotencyKey } from "./_shared/idempotency";
import { readCorrelationId } from "./_shared/correlation";
import { computeThreadId, normalizeLabels } from "./_shared/skymail";
import { emitSovereignEvent } from "./_shared/sovereign-events";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }

  const to = String(body.to || "").trim().toLowerCase();
  const subject = String(body.subject || "").trim();
  const text = String(body.text || "").trim();
  const channel = String(body.channel || "").trim();
  const fromAlias = String(body.from_alias || "").trim().toLowerCase();
  const replyToThread = String(body.thread_id || "").trim();
  const attachmentsInput = Array.isArray(body.attachments) ? body.attachments : [];
  const wsId = String(body.ws_id || "").trim();
  const idempotencyKey = readIdempotencyKey(event, body);
  const correlationId = readCorrelationId(event);

  if (!to || !subject || !text) {
    return json(400, { error: "Missing to, subject, or text." });
  }

  if (wsId) {
    const canRead = await canReadWorkspace(u.org_id, u.user_id, wsId);
    if (!canRead) return json(403, { error: "Workspace access denied." });
  }

  const senderAccount = await q(
    `select mailbox_email, display_name, outbound_enabled
     from skymail_accounts
     where org_id=$1 and user_id=$2
     limit 1`,
    [u.org_id, u.user_id]
  );
  if (!senderAccount.rows.length) {
    return json(400, { error: "SkyeMail account is not configured for this user." });
  }
  if (!senderAccount.rows[0]?.outbound_enabled) {
    return json(403, { error: "Outbound mail is disabled for this mailbox account." });
  }

  const mailbox = String(senderAccount.rows[0]?.mailbox_email || "").trim().toLowerCase();
  if (!mailbox) {
    return json(400, { error: "SkyeMail account mailbox email is missing." });
  }
  const displayName = String(senderAccount.rows[0]?.display_name || "").trim();
  const fromHeader = displayName ? `${displayName} <${mailbox}>` : mailbox;

  try {
    if (idempotencyKey) {
      const existing = await q(
        `select id, created_at
         from app_records
         where org_id=$1
           and ws_id is not distinct from $2
           and app='SkyeMail'
           and created_by=$3
           and payload->>'idempotency_key'=$4
         order by created_at desc
         limit 1`,
        [u.org_id, wsId || null, u.user_id, idempotencyKey]
      );
      if (existing.rows.length) {
        return json(200, {
          ok: true,
          duplicate: true,
          mail_record_id: existing.rows[0]?.id || null,
          provider: "idempotency-cache",
          provider_id: null,
          chat_hook_id: null,
        });
      }
    }

    const preparedAttachments = attachmentsInput
      .map((item: any) => {
        const filename = String(item?.filename || "").trim().slice(0, 200);
        const data = String(item?.data_base64 || "").trim();
        const contentType = String(item?.content_type || "application/octet-stream").trim();
        if (!filename || !data) return null;
        return {
          filename,
          contentType,
          content: Buffer.from(data, "base64"),
          size: Number(item?.size_bytes || 0),
        };
      })
      .filter(Boolean) as Array<{ filename: string; contentType: string; content: Buffer; size: number }>;

    const delivered = await sendMail({
      to,
      subject,
      text,
      from: fromHeader,
      attachments: preparedAttachments.map((item) => ({
        filename: item.filename,
        contentType: item.contentType,
        content: item.content,
      })),
    });

    const threadId = replyToThread || computeThreadId(mailbox, to, subject);
    const labels = normalizeLabels(body.labels, ["sent"]);

    const saved = await q(
      "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id, created_at",
      [
        u.org_id,
        wsId || null,
        "SkyeMail",
        subject,
        JSON.stringify({
          direction: "outbound",
          mailbox,
          from: mailbox,
          to,
          from_alias: fromAlias || null,
          subject,
          text,
          thread_id: threadId,
          labels,
          unread: false,
          starred: false,
          archived: false,
          attachments: preparedAttachments.map((item) => ({
            filename: item.filename,
            content_type: item.contentType,
            size_bytes: item.size || item.content.length,
          })),
          provider: delivered.provider,
          provider_id: delivered.id,
          idempotency_key: idempotencyKey || null,
        }),
        u.user_id,
      ]
    );

    let chatHookId: string | null = null;
    if (channel) {
      const hook = await q(
        "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id",
        [
          u.org_id,
          wsId || null,
          "SkyeChat",
          `Mail sent: ${subject}`,
          JSON.stringify({ channel, message: `Mail delivered to ${to}: ${subject}`, source: `SkyeMail${fromAlias ? ` (${fromAlias})` : ""}` }),
          u.user_id,
        ]
      );
      chatHookId = hook.rows[0]?.id || null;
    }

    await audit(u.email, u.org_id, null, "skymail.send.ok", {
      to,
      subject,
      provider: delivered.provider,
      provider_id: delivered.id,
      idempotency_key: idempotencyKey || null,
      correlation_id: correlationId || null,
      chat_hooked: !!chatHookId,
      chat_channel: channel || null,
    });

    await emitSovereignEvent({
      actor: u.email,
      actorUserId: u.user_id,
      orgId: u.org_id,
      wsId: wsId || null,
      eventType: "mail.sent",
      sourceApp: "SkyeMail",
      sourceRoute: "/api/skymail-send",
      subjectKind: "mail_thread",
      subjectId: threadId,
      severity: "info",
      summary: `SkyeMail sent: ${subject}`,
      correlationId,
      idempotencyKey,
      payload: {
        to,
        from: mailbox,
        subject,
        thread_id: threadId,
        provider: delivered.provider,
        provider_id: delivered.id,
        labels,
        attachment_count: preparedAttachments.length,
        chat_hook_id: chatHookId,
      },
    });

    return json(200, {
      ok: true,
      mail_record_id: saved.rows[0]?.id || null,
      provider: delivered.provider,
      provider_id: delivered.id,
      thread_id: threadId,
      labels,
      chat_hook_id: chatHookId,
    });
  } catch (e: any) {
    const msg = e?.message || "SkyeMail send failed.";
    await audit(u.email, u.org_id, null, "skymail.send.failed", {
      to,
      subject,
      correlation_id: correlationId || null,
      error: msg,
    });
    return json(500, { error: msg });
  }
};
