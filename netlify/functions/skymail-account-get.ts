import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const row = await q(
    `select id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata, updated_at
     from skymail_accounts
     where org_id=$1 and user_id=$2
     limit 1`,
    [u.org_id, u.user_id]
  );

  if (!row.rows.length) {
    return json(200, { ok: true, account: null });
  }

  const account = row.rows[0];
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
