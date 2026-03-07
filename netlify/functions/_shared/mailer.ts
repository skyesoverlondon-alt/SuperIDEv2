import { opt } from "./env";
import nodemailer from "nodemailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    contentType?: string;
    content: Buffer;
  }>;
};

type MailRuntimeStatus = {
  configured: boolean;
  active_provider: "smtp" | "resend" | null;
  from: string | null;
  sender_source: "MAIL_FROM" | "SKYE_MAIL_FROM" | "RESEND_FROM" | "SMTP_USER" | null;
  smtp: {
    configured: boolean;
    host: string | null;
    port: number | null;
    user: string | null;
  };
  resend: {
    configured: boolean;
  };
};

export function hasMailDeliveryConfig(): boolean {
  const smtpHost = opt("SMTP_HOST", "").trim();
  const smtpUser = opt("SMTP_USER", "").trim();
  const smtpPass = opt("SMTP_PASS", "").trim();
  const resendApiKey = opt("RESEND_API_KEY", "").trim();
  const mailFrom = resolveDefaultFrom({ smtpUser, requireExplicitResendSender: false });
  return Boolean(((smtpHost && smtpUser && smtpPass) || resendApiKey) && mailFrom);
}

function resolveDefaultFrom(input: { smtpUser: string; requireExplicitResendSender: boolean }): string {
  const explicitFrom = opt("MAIL_FROM", opt("SKYE_MAIL_FROM", opt("RESEND_FROM", ""))).trim();
  if (explicitFrom) return explicitFrom;
  if (EMAIL_RE.test(input.smtpUser)) return `SkyeMail <${input.smtpUser}>`;
  if (input.requireExplicitResendSender) return "";
  return "";
}

function resolveSenderSource(smtpUser: string): MailRuntimeStatus["sender_source"] {
  if (opt("MAIL_FROM", "").trim()) return "MAIL_FROM";
  if (opt("SKYE_MAIL_FROM", "").trim()) return "SKYE_MAIL_FROM";
  if (opt("RESEND_FROM", "").trim()) return "RESEND_FROM";
  if (EMAIL_RE.test(smtpUser)) return "SMTP_USER";
  return null;
}

export function getMailRuntimeStatus(): MailRuntimeStatus {
  const smtpHost = opt("SMTP_HOST", "").trim();
  const smtpPortRaw = Number(opt("SMTP_PORT", "587") || 587);
  const smtpUser = opt("SMTP_USER", "").trim();
  const smtpPass = opt("SMTP_PASS", "").trim();
  const resendApiKey = opt("RESEND_API_KEY", "").trim();
  const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass);
  const resendConfigured = Boolean(resendApiKey);
  const activeProvider = smtpConfigured ? "smtp" : resendConfigured ? "resend" : null;
  const from = resolveDefaultFrom({
    smtpUser,
    requireExplicitResendSender: Boolean(resendConfigured && !smtpConfigured),
  });

  return {
    configured: Boolean(activeProvider && from),
    active_provider: activeProvider,
    from: from || null,
    sender_source: resolveSenderSource(smtpUser),
    smtp: {
      configured: smtpConfigured,
      host: smtpHost || null,
      port: Number.isFinite(smtpPortRaw) ? smtpPortRaw : null,
      user: smtpUser || null,
    },
    resend: {
      configured: resendConfigured,
    },
  };
}

export async function sendMail(input: SendMailInput): Promise<{ provider: string; id: string | null }> {
  const smtpHost = opt("SMTP_HOST", "").trim();
  const smtpPort = Number(opt("SMTP_PORT", "587") || 587);
  const smtpUser = opt("SMTP_USER", "").trim();
  const smtpPass = opt("SMTP_PASS", "").trim();
  const resendApiKey = opt("RESEND_API_KEY", "").trim();
  const defaultFrom = resolveDefaultFrom({ smtpUser, requireExplicitResendSender: Boolean(resendApiKey && !(smtpHost && smtpUser && smtpPass)) });
  const from = String(input.from || defaultFrom).trim() || defaultFrom;

  if (!from) {
    throw new Error("Mail sender identity is not configured. Set MAIL_FROM, SKYE_MAIL_FROM, or RESEND_FROM. For SMTP, SMTP_USER may also be used if it is a full email address.");
  }

  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: Number(smtpPort) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await (transporter as any).verify();

    const sent = await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      attachments: Array.isArray(input.attachments)
        ? input.attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            content: a.content,
          }))
        : undefined,
    });

    return {
      provider: "smtp",
      id: sent?.messageId || null,
    };
  }

  if (!resendApiKey) {
    throw new Error("No mail provider configured. Set SMTP_* (recommended) or RESEND_API_KEY.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      attachments: Array.isArray(input.attachments)
        ? input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString("base64"),
          }))
        : undefined,
    }),
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Resend send failed (${res.status})`);
  }

  return {
    provider: "resend",
    id: data?.id || null,
  };
}
