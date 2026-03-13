const { ok, fail, readJson, requireEnv } = require('./_utils');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed.');
  try {
    const body = await readJson(event);
    const token = requireEnv('GITHUB_TOKEN');
    const owner = body.owner || process.env.DEFAULT_GH_OWNER;
    const repo = body.repo || process.env.DEFAULT_GH_REPO;
    const branch = body.branch || process.env.DEFAULT_GH_BRANCH || 'main';
    if (!owner || !repo) return fail(400, 'Repo owner and repo name are required.');

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'skye-codex-ide-env'
      }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return fail(res.status, data?.message || 'GitHub access test failed.', { detail: data });

    return ok({ full_name: `${owner}/${repo}`, branch, sha: data.commit?.sha || '' });
  } catch (err) {
    return fail(500, err.message || 'GitHub test failed.');
  }
};
