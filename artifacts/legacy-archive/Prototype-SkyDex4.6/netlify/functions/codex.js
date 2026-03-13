const { ok, fail, readJson, requireEnv } = require('./_utils');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed.');

  try {
    const body = await readJson(event);
    const apiKey = requireEnv('OPENAI_API_KEY');
    const model = body.modelOverride || process.env.OPENAI_CODEX_MODEL || 'gpt-5.4';
    const endpoint = process.env.OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses';
    const files = body.files || {};
    const projectName = body.projectName || 'skye-codex-project';
    const prompt = (body.prompt || '').trim();

    if (!prompt) return fail(400, 'Prompt is required.');

    const context = Object.entries(files)
      .map(([name, content]) => `FILE: ${name}\n---\n${content}`)
      .join('\n\n');

    const input = [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'You are an expert code editor working inside a browser IDE. Return either a full file replacement beginning exactly with FILE: filename on the first line followed by the full file content, or return concise implementation guidance if a file should not be auto-applied. Prefer complete file outputs over partial patches.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Project: ${projectName}\n\nCurrent files:\n${context}\n\nUser request:\n${prompt}`
          }
        ]
      }
    ];

    const payload = {
      model,
      input
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return fail(res.status, data?.error?.message || 'OpenAI request failed.', { detail: data });
    }

    return ok({ response: data });
  } catch (err) {
    return fail(500, err.message || 'Codex function failed.');
  }
};
