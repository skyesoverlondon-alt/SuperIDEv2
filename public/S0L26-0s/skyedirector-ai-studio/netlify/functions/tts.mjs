import { bad, json, readJson } from './_lib/http.mjs';
import { speech } from './_lib/openai.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const { input, voice, instructions } = await readJson(req);
  if (!input) return bad('Input text is required');
  const audioBase64 = await speech({ input, voice, instructions, format: 'mp3' });
  return json({ audioBase64, mimeType: 'audio/mpeg' });
}
