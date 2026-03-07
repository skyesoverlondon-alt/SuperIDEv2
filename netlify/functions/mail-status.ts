import { json } from "./_shared/response";
import { forbid, requireUser } from "./_shared/auth";
import { getMailRuntimeStatus } from "./_shared/mailer";

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();

  const status = getMailRuntimeStatus();

  return json(200, {
    configured: status.configured,
    active_provider: status.active_provider,
    from: status.from,
    sender_source: status.sender_source,
    smtp: status.smtp,
    resend: status.resend,
  });
};