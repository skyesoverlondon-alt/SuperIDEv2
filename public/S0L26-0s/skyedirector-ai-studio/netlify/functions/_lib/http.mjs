export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

export function bad(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
