export interface Env {
  RUNNER_SHARED_SECRET?: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'skyedirector-render-runner', secretConfigured: Boolean(env.RUNNER_SHARED_SECRET) });
    }
    if (url.pathname === '/render-plan') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const auth = request.headers.get('x-runner-secret');
      if (!env.RUNNER_SHARED_SECRET || auth !== env.RUNNER_SHARED_SECRET) {
        return json({ error: 'Forbidden' }, 403);
      }
      const body = await request.json<unknown>();
      return json({
        ok: true,
        message: 'Worker lane is present for future FFmpeg / R2 / evidence-pack upgrades.',
        received: body
      });
    }
    return json({ error: 'Not found' }, 404);
  }
};
