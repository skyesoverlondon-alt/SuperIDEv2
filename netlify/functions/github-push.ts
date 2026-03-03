import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { runnerCall } from "./_shared/runner";

/**
 * Trigger a Git push for the current user's workspace.  This endpoint
 * requires that the user has previously connected a GitHub App
 * installation via `github-app-connect`.  The function looks up the
 * repository, branch and installation ID from the `integrations`
 * table, emits an audit event, and delegates the actual push to
 * the Cloudflare Worker via an authenticated call.  If the push
 * succeeds the Worker returns the commit SHA and ref.  All errors
 * are recorded to the audit log.
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
  const ws_id = body.ws_id;
  const message = body.message;
  if (!ws_id) {
    return json(400, { error: "Missing ws_id." });
  }
  // Fetch GitHub integration details.  We only proceed if an
  // installation ID and repository are present.  The branch
  // defaults to 'main' when not specified.
  const r = await q(
    "select github_repo, github_branch, github_installation_id from integrations where user_id=$1",
    [u.user_id]
  );
  if (
    !r.rows.length ||
    !r.rows[0].github_repo ||
    !r.rows[0].github_installation_id
  ) {
    return json(400, { error: "GitHub App not connected." });
  }
  const repo: string = r.rows[0].github_repo;
  const branch: string = r.rows[0].github_branch || "main";
  const installation_id: number = Number(r.rows[0].github_installation_id);
  await audit(u.email, u.org_id, ws_id, "git.push.requested", {
    repo,
    branch,
    installation_id,
  });
  try {
    const out = await runnerCall<{
      ok: boolean;
      commit_sha: string;
      ref: string;
    }>("/v1/github/app/push", {
      user_id: u.user_id,
      org_id: u.org_id,
      ws_id,
      repo,
      branch,
      installation_id,
      message:
        message || `kAIxU Super IDE update (${new Date().toISOString()})`,
    });
    await audit(u.email, u.org_id, ws_id, "git.push.ok", out);
    return json(200, out);
  } catch (e: any) {
    const err = e?.message || "Git push failed.";
    await audit(u.email, u.org_id, ws_id, "git.push.failed", {
      error: err,
    });
    return json(500, { error: err });
  }
};