import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { computeThreadId, normalizeLabels } from "./_shared/skymail";

function readIngestSecret(event: any): string {
  const header = event?.headers || {};
  return String(header["x-mail-ingest-secret"] || header["X-Mail-Ingest-Secret"] || "").trim();
}

export const handler = async (event: any) => {
  const expected = String(process.env.MAIL_INGEST_SECRET || "").trim();
  if (!expected) return json(503, { error: "MAIL_INGEST_SECRET is not configured." });

  const provided = readIngestSecret(event);
  if (!provided || provided !== expected) return json(401, { error: "Unauthorized." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const from = String(body.from || "").trim().toLowerCase();
  const to = String(body.to || "").trim().toLowerCase();
  const subject = String(body.subject || "").trim();
  const text = String(body.text || body.body_text || "").trim();
  const html = String(body.html || body.body_html || "").trim();
  const providerMessageId = String(body.message_id || body.provider_message_id || "").trim();
  const receivedAt = String(body.received_at || "").trim();
  const explicitThreadId = String(body.thread_id || "").trim();
  const attachmentsInput = Array.isArray(body.attachments) ? body.attachments : [];

  if (!to || !subject || (!text && !html)) {
    return json(400, { error: "Missing to, subject, or message body." });
  }

  const account = await q(
    `select sa.org_id, sa.user_id, sa.inbound_enabled
     from skymail_accounts sa
     where lower(sa.mailbox_email)=lower($1)
     order by sa.updated_at desc
     limit 1`,
    [to]
  );

  if (!account.rows.length) {
    return json(404, { error: "No mailbox account mapped for recipient." });
  }

  if (!account.rows[0]?.inbound_enabled) {
    return json(403, { error: "Inbound mail is disabled for this mailbox account." });
  }

  const orgId = String(account.rows[0].org_id);
  const userId = String(account.rows[0].user_id);

  if (providerMessageId) {
    const dedupe = await q(
      `select id
       from app_records
       where org_id=$1
         and app='SkyeMailInbound'
         and payload->>'provider_message_id'=$2
       limit 1`,
      [orgId, providerMessageId]
    );
    if (dedupe.rows.length) {
      return json(200, { ok: true, duplicate: true, id: dedupe.rows[0]?.id || null });
    }
  }

  const title = subject.slice(0, 240) || "(no subject)";
  const threadId = explicitThreadId || computeThreadId(to, from, subject);
  const labels = normalizeLabels(body.labels, ["inbox", "unread"]);
  const payload = {
    direction: "inbound",
    mailbox: to,
    from,
    subject,
    text: text || null,
    html: html || null,
    thread_id: threadId,
    labels,
    unread: true,
    starred: false,
    archived: false,
    attachments: attachmentsInput
      .map((item: any) => ({
        filename: String(item?.filename || "").trim().slice(0, 200),
        content_type: String(item?.content_type || "application/octet-stream").trim(),
        size_bytes: Number(item?.size_bytes || 0),
      }))
      .filter((item: any) => item.filename),
    provider: String(body.provider || "smtp").trim().toLowerCase() || "smtp",
    provider_message_id: providerMessageId || null,
    received_at: receivedAt || new Date().toISOString(),
  };

  const inserted = await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,$2,$3,$4,$5::jsonb,$6)
     returning id, created_at`,
    [orgId, null, "SkyeMailInbound", title, JSON.stringify(payload), userId]
  );

  return json(200, {
    ok: true,
    id: inserted.rows[0]?.id || null,
    mailbox: to,
    received_at: payload.received_at,
  });
};
