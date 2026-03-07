const { ok, fail, readJson, requireEnv } = require('./_utils');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed.');
  try {
    const body = await readJson(event);
    const token = requireEnv('NETLIFY_TOKEN');
    const siteId = body.siteId || process.env.DEFAULT_NETLIFY_SITE_ID;
    if (!siteId) return fail(400, 'Netlify site id is required.');

    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return fail(res.status, data?.message || 'Netlify site access test failed.', { detail: data });

    return ok({ site_id: data.id, name: data.name, url: data.ssl_url || data.url || '' });
  } catch (err) {
    return fail(500, err.message || 'Netlify test failed.');
  }
};
