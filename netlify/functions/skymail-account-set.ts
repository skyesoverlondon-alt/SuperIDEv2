import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDERS = new Set(["gmail_smtp", "resend", "custom_smtp"]);

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const mailboxEmail = String(body.mailbox_email || "").trim().toLowerCase();
  const displayName = String(body.display_name || "").trim().slice(0, 120);
  const provider = String(body.provider || "gmail_smtp").trim().toLowerCase();
  const outboundEnabled = body.outbound_enabled !== false;
  const inboundEnabled = body.inbound_enabled === true;
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

  if (!mailboxEmail || !EMAIL_RE.test(mailboxEmail)) {
    return json(400, { error: "Valid mailbox_email is required." });
  }
  if (!PROVIDERS.has(provider)) {
    return json(400, { error: "Unsupported provider." });
  }

  const result = await q(
    `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata, updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
     on conflict (org_id, user_id)
     do update set
       mailbox_email=excluded.mailbox_email,
       display_name=excluded.display_name,
       provider=excluded.provider,
       outbound_enabled=excluded.outbound_enabled,
       inbound_enabled=excluded.inbound_enabled,
       metadata=excluded.metadata,
       updated_at=now()
     returning id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata, updated_at`,
    [
      u.org_id,
      u.user_id,
      mailboxEmail,
      displayName || null,
      provider,
      outboundEnabled,
      inboundEnabled,
      JSON.stringify(metadata),
    ]
  );

  const account = result.rows[0];

  await audit(u.email, u.org_id, null, "skymail.account.set", {
    mailbox_email: mailboxEmail,
    provider,
    outbound_enabled: outboundEnabled,
    inbound_enabled: inboundEnabled,
  });

  return json(200, {
    ok: true,
    account: {
      id: account.id,
      mailbox_email: account.mailbox_email,
      display_name: account.display_name || "",
      provider: account.provider,
      outbound_enabled: Boolean(account.outbound_enabled),
      inbound_enabled: Boolean(account.inbound_enabled),
      metadata: account.metadata || {},
      updated_at: account.updated_at || null,
    },
  });
};
