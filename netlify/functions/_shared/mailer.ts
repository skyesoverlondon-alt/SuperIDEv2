import { opt } from "./env";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(input: SendMailInput): Promise<{ provider: string; id: string | null }> {
  const resendApiKey = opt("RESEND_API_KEY", "").trim();
  const from = opt("SKYE_MAIL_FROM", "SkyeMail <onboarding@resend.dev>").trim();

  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY environment variable.");
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
