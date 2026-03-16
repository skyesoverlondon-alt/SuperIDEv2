const API_ROOT = 'https://api.openai.com/v1';

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is missing. Add it in Netlify Functions env vars.');
  return key;
}

async function call(path, init = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OpenAI call failed: ${response.status}`);
  }
  return response;
}

export async function createResponse({ system, prompt, temperature = 0.8, responseFormat }) {
  const model = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
  const body = {
    model,
    temperature,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: system }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }]
      }
    ]
  };
  if (responseFormat) {
    body.text = {
      format: responseFormat
    };
  }
  const response = await call('/responses', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return response.json();
}

export async function speech({ input, voice = 'coral', instructions = '', format = 'mp3' }) {
  const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
  const response = await call('/audio/speech', {
    method: 'POST',
    body: JSON.stringify({ model, input, voice, instructions, format })
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

export async function transcribe(formData) {
  const response = await call('/audio/transcriptions', {
    method: 'POST',
    body: formData
  });
  return response.json();
}

export async function generateImage({ prompt, size = '1024x1024', quality = 'medium', output_format = 'png' }) {
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const response = await call('/images/generations', {
    method: 'POST',
    body: JSON.stringify({ model, prompt, size, quality, output_format })
  });
  return response.json();
}
