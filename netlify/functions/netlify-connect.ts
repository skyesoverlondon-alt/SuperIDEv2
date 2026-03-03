import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { runnerCall } from "./_shared/runner";

/**
 * Connect a Netlify site to the current user.  Accepts a personal
 * access token and site ID (and optional site name).  The token is
 * vaulted in the Cloudflare Worker via the `/v1/vault/netlify/store`
 * endpoint.  Only a pointer (site ID/name) is stored in the
 * database.  Emits an audit event on success.
 */
export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }
  const token: string | undefined = body.token;
  const site_id: string | undefined = body.site_id;
  const site_name: string | undefined = body.site_name;
  if (!token || !site_id) {
    return json(400, { error: "Missing token or site_id." });
  }
  // Vault the Netlify token in the Worker.  This stores an encrypted
  // blob keyed by user_id in KV; the token never touches the DB.
  await runnerCall("/v1/vault/netlify/store", {
    user_id: u.user_id,
    token,
  });
  // Upsert integration metadata in Neon.  Only site id and name are stored.
  await q(
    "insert into integrations(user_id, netlify_site_id, netlify_site_name) values($1,$2,$3) on conflict(user_id) do update set netlify_site_id=excluded.netlify_site_id, netlify_site_name=excluded.netlify_site_name, updated_at=now()",
    [u.user_id, site_id, site_name || null]
  );
  await audit(u.email, u.org_id, null, "netlify.connect", {
    site_id,
    site_name: site_name || null,
  });
  return json(200, { ok: true });
};