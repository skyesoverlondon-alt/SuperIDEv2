function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function ok(body) {
  return json(200, { ok: true, ...body });
}

function fail(statusCode, error, extra = {}) {
  return json(statusCode, { ok: false, error, ...extra });
}

async function readJson(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function normalizeBasePath(path) {
  return (path || '').replace(/^\/+|\/+$/g, '');
}

function encodeBase64Utf8(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

function decodeOutputText(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text) return response.output_text;
  if (Array.isArray(response.output)) {
    return response.output.map(item => {
      if (Array.isArray(item.content)) {
        return item.content.map(c => c.text || c.input_text || '').join('\n');
      }
      return item.text || '';
    }).join('\n');
  }
  return JSON.stringify(response, null, 2);
}

module.exports = {
  json,
  ok,
  fail,
  readJson,
  requireEnv,
  normalizeBasePath,
  encodeBase64Utf8,
  decodeOutputText
};
