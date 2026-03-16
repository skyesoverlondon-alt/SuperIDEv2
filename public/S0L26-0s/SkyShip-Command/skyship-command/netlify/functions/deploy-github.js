const { json, readBody, requirePost, requireField, normalizeFiles, fetchJson } = require("./shared");

async function gh(path, token, method = "GET", body) {
  return fetchJson(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "skyship-command",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

exports.handler = async (event) => {
  const gate = requirePost(event);
  if (gate) return gate;

  try {
    const body = readBody(event);
    const token = requireField(body, "token", "GitHub token");
    const owner = requireField(body, "owner", "GitHub owner");
    const repo = requireField(body, "repo", "GitHub repo");
    const branch = requireField(body, "branch", "GitHub branch");
    const message = String(body.message || `SkyShip Command update · ${new Date().toISOString()}`);
    const files = normalizeFiles(body.files);

    const repoInfo = await gh(`/repos/${owner}/${repo}`, token);
    const defaultBranch = repoInfo.default_branch || "main";

    let headRef;
    let baseBranch = branch;
    let refExists = true;
    try {
      headRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    } catch (error) {
      if (error.status !== 404) throw error;
      refExists = false;
      baseBranch = defaultBranch;
      headRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, token);
    }

    const headSha = headRef.object.sha;
    const headCommit = await gh(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
    const baseTreeSha = headCommit.tree.sha;

    const tree = [];
    for (const file of files) {
      const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, token, "POST", {
        content: file.contentBase64,
        encoding: "base64",
      });
      tree.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, token, "POST", {
      base_tree: baseTreeSha,
      tree,
    });

    const newCommit = await gh(`/repos/${owner}/${repo}/git/commits`, token, "POST", {
      message,
      tree: newTree.sha,
      parents: [headSha],
    });

    if (refExists) {
      await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, "PATCH", {
        sha: newCommit.sha,
        force: false,
      });
    } else {
      await gh(`/repos/${owner}/${repo}/git/refs`, token, "POST", {
        ref: `refs/heads/${branch}`,
        sha: newCommit.sha,
      });
    }

    return json(200, {
      ok: true,
      owner,
      repo,
      branch,
      ref: `refs/heads/${branch}`,
      commit_sha: newCommit.sha,
      file_count: tree.length,
      compare_url: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}`,
    });
  } catch (error) {
    return json(500, { error: error.message || "GitHub push failed." });
  }
};
