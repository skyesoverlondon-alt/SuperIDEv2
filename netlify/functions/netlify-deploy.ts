import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { runnerCall } from "./_shared/runner";
import { canWriteWorkspace } from "./_shared/rbac";
import { buildSknoreReleasePlan } from "./_shared/sknore";

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
  const allowed = await canWriteWorkspace(u.org_id, u.user_id, ws_id);
  if (!allowed) return json(403, { error: "Workspace write denied." });

  const releasePlan = await buildSknoreReleasePlan(u.org_id, ws_id);
  if (!releasePlan.files.length) {
    return json(400, { error: "Workspace is empty." });
  }
  if (!releasePlan.releaseFiles.length) {
    return json(400, { error: "All workspace files are SKNore-protected. Nothing can be deployed to Netlify." });
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
    sknore_blocked: releasePlan.blockedPaths.length,
  });
  try {
    const out = await runnerCall<{
      ok: boolean;
      deploy_id: string;
      url?: string;
      required?: number;
      included_count?: number;
    }>("/v1/netlify/deploy", {
      user_id: u.user_id,
      org_id: u.org_id,
      ws_id,
      site_id,
      files: releasePlan.releaseFiles,
      title:
        title || `kAIxU Super IDE deploy (${new Date().toISOString()})`,
    });
    const payload = {
      ...out,
      sknore: {
        included_count: releasePlan.releaseFiles.length,
        blocked_count: releasePlan.blockedPaths.length,
        blocked_paths: releasePlan.blockedPaths,
        patterns_count: releasePlan.patterns.length,
      },
    };
    await audit(u.email, u.org_id, ws_id, "deploy.ok", payload);
    return json(200, payload);
  } catch (e: any) {
    const err = e?.message || "Deploy failed.";
    await audit(u.email, u.org_id, ws_id, "deploy.failed", {
      error: err,
    });
    return json(500, { error: err });
  }
};