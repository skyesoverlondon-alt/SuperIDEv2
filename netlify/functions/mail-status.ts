import { json } from "./_shared/response";
import { forbid, requireUser } from "./_shared/auth";
import { getMailRuntimeStatus } from "./_shared/mailer";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();

  const status = getMailRuntimeStatus();
  const ingestSecretConfigured = Boolean(String(process.env.MAIL_INGEST_SECRET || "").trim());
  let account: any = null;
  let syncState: any = null;

  if (u.org_id) {
    const accountRes = await q(
      `select mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata, updated_at
         from skymail_accounts
        where org_id=$1 and user_id=$2
        limit 1`,
      [u.org_id, u.user_id]
    );
    account = accountRes.rows[0] || null;

    if (account?.mailbox_email) {
      const syncRes = await q(
        `select provider, last_cursor, last_synced_at, status, error, updated_at
           from skymail_sync_state
          where org_id=$1 and lower(mailbox_email)=lower($2)
          order by updated_at desc
          limit 1`,
        [u.org_id, String(account.mailbox_email)]
      );
      syncState = syncRes.rows[0] || null;
    }
  }

  return json(200, {
    configured: status.configured,
    active_provider: status.active_provider,
    from: status.from,
    sender_source: status.sender_source,
    smtp: status.smtp,
    resend: status.resend,
    ingest_secret_configured: ingestSecretConfigured,
    account: account
      ? {
          mailbox_email: account.mailbox_email,
          display_name: account.display_name || "",
          provider: account.provider,
          outbound_enabled: Boolean(account.outbound_enabled),
          inbound_enabled: Boolean(account.inbound_enabled),
          metadata: account.metadata || {},
          updated_at: account.updated_at || null,
        }
      : null,
    sync_state: syncState
      ? {
          provider: syncState.provider,
          last_cursor: syncState.last_cursor || null,
          last_synced_at: syncState.last_synced_at || null,
          status: syncState.status,
          error: syncState.error || null,
          updated_at: syncState.updated_at || null,
        }
      : null,
  });
};