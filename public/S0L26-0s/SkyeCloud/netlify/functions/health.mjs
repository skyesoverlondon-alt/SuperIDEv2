export default async () => {
  return new Response(JSON.stringify({
    ok: true,
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    app: 'SkyeCloud',
    ai: 'kAIxU'
  }), { headers: { 'Content-Type': 'application/json' } });
};
