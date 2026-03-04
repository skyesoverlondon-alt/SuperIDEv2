import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { sendMail } from "./_shared/mailer";

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

  if (!to || !subject || !text) {
    return json(400, { error: "Missing to, subject, or text." });
  }

  try {
    const delivered = await sendMail({ to, subject, text });

    const saved = await q(
      "insert into app_records(org_id, app, title, payload, created_by) values($1,$2,$3,$4::jsonb,$5) returning id, created_at",
      [
        u.org_id,
        "SkyeMail",
        subject,
        JSON.stringify({ to, subject, text, provider: delivered.provider, provider_id: delivered.id }),
        u.user_id,
      ]
    );

    let chatHookId: string | null = null;
    if (channel) {
      const hook = await q(
        "insert into app_records(org_id, app, title, payload, created_by) values($1,$2,$3,$4::jsonb,$5) returning id",
        [
          u.org_id,
          "SkyeChat",
          `Mail sent: ${subject}`,
          JSON.stringify({ channel, message: `Mail delivered to ${to}: ${subject}`, source: "SkyeMail" }),
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
      chat_hooked: !!chatHookId,
      chat_channel: channel || null,
    });

    return json(200, {
      ok: true,
      mail_record_id: saved.rows[0]?.id || null,
      provider: delivered.provider,
      provider_id: delivered.id,
      chat_hook_id: chatHookId,
    });
  } catch (e: any) {
    const msg = e?.message || "SkyeMail send failed.";
    await audit(u.email, u.org_id, null, "skymail.send.failed", {
      to,
      subject,
      error: msg,
    });
    return json(500, { error: msg });
  }
};
