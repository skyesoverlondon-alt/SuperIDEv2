const { ok, fail, readJson, requireEnv, normalizeBasePath, encodeBase64Utf8 } = require('./_utils');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed.');
  try {
    const body = await readJson(event);
    const token = requireEnv('GITHUB_TOKEN');
    const owner = body.owner || process.env.DEFAULT_GH_OWNER;
    const repo = body.repo || process.env.DEFAULT_GH_REPO;
    const branch = body.branch || process.env.DEFAULT_GH_BRANCH || 'main';
    const basePath = normalizeBasePath(body.basePath || '');
    const message = body.message || 'Update from Skye Codex IDE';
    const files = body.files || {};

    if (!owner || !repo) return fail(400, 'Repo owner and repo name are required.');
    if (!Object.keys(files).length) return fail(400, 'No files provided.');

    const pushed = [];

    for (const [name, content] of Object.entries(files)) {
      const path = basePath ? `${basePath}/${name}` : name;
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
      let sha = '';

      const existing = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'skye-codex-ide-env'
        }
      });
      if (existing.ok) {
        const current = await existing.json();
        sha = current.sha || '';
      }

      const payload = {
        message,
        branch,
        content: encodeBase64Utf8(String(content))
      };
      if (sha) payload.sha = sha;

      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'skye-codex-ide-env'
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return fail(res.status, data?.message || `GitHub push failed on ${path}.`, { detail: data, path });
      }
      pushed.push(path);
    }

    return ok({ pushed: pushed.length, paths: pushed });
  } catch (err) {
    return fail(500, err.message || 'GitHub push failed.');
  }
};
