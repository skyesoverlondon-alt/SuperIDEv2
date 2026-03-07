/*
 * Implements pushing a commit to a GitHub repository using a
 * GitHub App installation token.  This module fetches the
 * current branch head, constructs blobs and a tree for all
 * workspace files, creates a new commit and updates the ref.
 * It depends on the `neon` helper to fetch workspace files from
 * the database and the `github_app` helper to mint tokens.
 */

import { q } from "./neon";
import { getInstallationToken } from "./github_app";

/**
 * Call the GitHub REST API with the provided token.  Accepts
 * path, HTTP method and body.  Throws on failure and returns
 * parsed JSON on success.
 */
async function gh(apiPath: string, token: string, method: string, body?: any): Promise<any> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "kaixu-superide-runner",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.message || `GitHub API error (${res.status})`);
  }
  return data;
}

/**
 * Perform a push from a workspace to a GitHub repository using a
 * GitHub App installation.  Reads workspace files from Neon,
 * mints an installation token and uses the Git Data API to
 * construct the commit.  Returns an object with the new commit
 * SHA and ref name on success.
 */
export async function githubAppPushFromWorkspace(
  env: any,
  installation_id: number,
  ws_id: string,
  repo: string,
  branch: string,
  message: string,
  filesOverride?: Array<{ path: string; content: string }>
): Promise<{ ok: true; commit_sha: string; ref: string; included_count: number }> {
  const token = await getInstallationToken(env, installation_id);
  // Load workspace files from Neon.  The files_json column holds
  // an array of objects with "path" and "content" fields.
  const ws = Array.isArray(filesOverride)
    ? { rows: [{ files_json: filesOverride }] }
    : await q(env, "select files_json from workspaces where id=$1", [ws_id]);
  if (!ws.rows.length) throw new Error("Workspace not found.");
  const files: { path: string; content: string }[] = ws.rows[0].files_json || [];
  if (!files.length) throw new Error("Workspace is empty.");
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("Invalid repo format. Use OWNER/REPO.");
  // Get current ref (branch head)
  const ref = await gh(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`, token, "GET");
  const headSha = ref.object.sha;
  // Get base tree
  const commit = await gh(`/repos/${owner}/${name}/git/commits/${headSha}`, token, "GET");
  const baseTreeSha = commit.tree.sha;
  // Create blobs and tree entries
  const tree: any[] = [];
  for (const f of files) {
    if (!f.path || f.path.includes("..") || f.path.startsWith("/")) continue;
    const blob = await gh(`/repos/${owner}/${name}/git/blobs`, token, "POST", {
      content: f.content ?? "",
      encoding: "utf-8",
    });
    tree.push({
      path: f.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }
  const newTree = await gh(`/repos/${owner}/${name}/git/trees`, token, "POST", {
    base_tree: baseTreeSha,
    tree,
  });
  const newCommit = await gh(`/repos/${owner}/${name}/git/commits`, token, "POST", {
    message,
    tree: newTree.sha,
    parents: [headSha],
  });
  await gh(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, token, "PATCH", {
    sha: newCommit.sha,
    force: false,
  });
  return { ok: true, commit_sha: newCommit.sha, ref: `refs/heads/${branch}`, included_count: tree.length };
}