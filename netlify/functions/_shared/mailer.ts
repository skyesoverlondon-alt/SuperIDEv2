import { opt } from "./env";
import nodemailer from "nodemailer";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  from?: string;
};

export async function sendMail(input: SendMailInput): Promise<{ provider: string; id: string | null }> {
  const smtpHost = opt("SMTP_HOST", "").trim();
  const smtpPort = Number(opt("SMTP_PORT", "587") || 587);
  const smtpUser = opt("SMTP_USER", "").trim();
  const smtpPass = opt("SMTP_PASS", "").trim();
  const defaultFrom = opt("MAIL_FROM", opt("SKYE_MAIL_FROM", "SkyeMail <onboarding@resend.dev>")).trim();
  const from = String(input.from || defaultFrom).trim() || defaultFrom;

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

    const sent = await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });

    return {
      provider: "smtp",
      id: sent?.messageId || null,
    };
  }

  const resendApiKey = opt("RESEND_API_KEY", "").trim();
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
