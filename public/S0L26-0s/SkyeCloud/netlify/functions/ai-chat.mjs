export default async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not configured on the server.' }), { status: 500, headers });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const { prompt = '', system = 'You are kAIxU, the creative engineering assistant for SkyeCloud.' } = await req.json().catch(() => ({}));

  if (!String(prompt).trim()) {
    return new Response(JSON.stringify({ error: 'Prompt is required.' }), { status: 400, headers });
  }

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: prompt }] }
      ],
      temperature: 0.6
    })
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: data?.error?.message || 'Upstream AI error.' }), { status: upstream.status, headers });
  }

  const output = data.output_text || data.output?.map(item => item?.content?.map(c => c.text).join('')).join('\n') || '';
  return new Response(JSON.stringify({ ok: true, output, model, ai: 'kAIxU', provider: 'Skyes Over London' }), { headers });
};
