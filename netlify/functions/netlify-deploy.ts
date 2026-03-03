import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { runnerCall } from "./_shared/runner";

/**
 * Trigger a Netlify deploy for the current user's workspace.  This
 * endpoint requires a connected Netlify site (vaulted token) and
 * writes an audit event before and after the deploy.  The deploy
 * itself is executed in the Worker runner, which uses the stored
 * token and workspace files to create a new deploy.  Errors are
 * surfaced back to the client.
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
  const ws_id: string | undefined = body.ws_id;
  const title: string | undefined = body.title;
  if (!ws_id) {
    return json(400, { error: "Missing ws_id." });
  }
  // Load Netlify site info from the integrations table.
  const r = await q(
    "select netlify_site_id, netlify_site_name from integrations where user_id=$1",
    [u.user_id]
  );
  if (!r.rows.length || !r.rows[0].netlify_site_id) {
    return json(400, { error: "Netlify not connected." });
  }
  const site_id: string = r.rows[0].netlify_site_id;
  const site_name: string | null = r.rows[0].netlify_site_name || null;
  await audit(u.email, u.org_id, ws_id, "deploy.requested", {
    site_id,
    site_name,
  });
  try {
    const out = await runnerCall<{
      ok: boolean;
      deploy_id: string;
      url?: string;
      required?: number;
    }>("/v1/netlify/deploy", {
      user_id: u.user_id,
      org_id: u.org_id,
      ws_id,
      site_id,
      title:
        title || `kAIxU Super IDE deploy (${new Date().toISOString()})`,
    });
    await audit(u.email, u.org_id, ws_id, "deploy.ok", out);
    return json(200, out);
  } catch (e: any) {
    const err = e?.message || "Deploy failed.";
    await audit(u.email, u.org_id, ws_id, "deploy.failed", {
      error: err,
    });
    return json(500, { error: err });
  }
};