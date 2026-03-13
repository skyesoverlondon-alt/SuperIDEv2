/**
 * _lib/openai.js — Raw OpenAI API client (no SDK dependency)
 *
 * Uses fetch() directly against the OpenAI API.
 * Env: OPENAI_API_KEY (required), OPENAI_BASE_URL (optional, defaults to https://api.openai.com)
 *
 * Exports:
 *   chatCompletion({ model, messages, tools, tool_choice, temperature, max_tokens })
 *   chatCompletionStream({ model, messages, tools, ... }) → ReadableStream of SSE
 *   codeCompletion({ model, prompt, suffix, temperature, max_tokens })
 */

const BASE_URL = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');

function getApiKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY not configured');
  return k;
}

function headers(extra = {}) {
  return {
    'Authorization': `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/**
 * Standard (non-streaming) chat completion.
 * Returns the full parsed response object from OpenAI.
 */
async function chatCompletion({
  model = 'gpt-4o',
  messages,
  tools,
  tool_choice,
  temperature = 0.2,
  max_tokens = 16384,
  response_format,
} = {}) {
  const body = { model, messages, temperature, max_tokens };
  if (tools?.length) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;
  if (response_format) body.response_format = response_format;

  const res = await fetch(`${BASE_URL()}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI error (HTTP ${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Streaming chat completion. Returns the raw fetch Response so the caller
 * can read the body stream and forward SSE events.
 */
async function chatCompletionStream({
  model = 'gpt-4o',
  messages,
  tools,
  tool_choice,
  temperature = 0.2,
  max_tokens = 16384,
} = {}) {
  const body = { model, messages, temperature, max_tokens, stream: true };
  if (tools?.length) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;

  const res = await fetch(`${BASE_URL()}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error?.message || `OpenAI stream error (HTTP ${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}

/**
 * Inline code completion using the chat endpoint with a fill-in-middle approach.
 */
async function codeCompletion({
  model = 'gpt-4o-mini',
  fileContent,
  cursorOffset,
  filePath = '',
  language = '',
  temperature = 0.1,
  max_tokens = 256,
} = {}) {
  const prefix = fileContent.slice(0, cursorOffset);
  const suffix = fileContent.slice(cursorOffset);

  // Use last 2000 chars of prefix and first 500 of suffix for context
  const ctxPrefix = prefix.slice(-2000);
  const ctxSuffix = suffix.slice(0, 500);

  const systemPrompt = `You are an expert code completion engine. Given the code before and after the cursor, output ONLY the code that should be inserted at the cursor position. No explanation, no markdown, no backticks — just the raw code to insert. If no completion makes sense, output nothing.`;

  const userPrompt = `File: ${filePath || 'untitled'}${language ? ` (${language})` : ''}

CODE BEFORE CURSOR:
\`\`\`
${ctxPrefix}
\`\`\`

CODE AFTER CURSOR:
\`\`\`
${ctxSuffix}
\`\`\`

Output ONLY the code to insert at the cursor:`;

  const data = await chatCompletion({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens,
  });

  const text = data.choices?.[0]?.message?.content || '';
  // Strip any accidental markdown fences
  return text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trimEnd();
}

/**
 * Check if OpenAI is configured
 */
function isConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

module.exports = {
  chatCompletion,
  chatCompletionStream,
  codeCompletion,
  isConfigured,
};
