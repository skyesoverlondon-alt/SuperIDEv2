import { bad, json } from './_lib/http.mjs';
import { transcribe } from './_lib/openai.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const incoming = await req.formData();
  const file = incoming.get('file');
  if (!file) return bad('File is required');

  const formData = new FormData();
  formData.append('file', file, file.name || 'upload.bin');
  formData.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
  formData.append('response_format', 'json');
  const language = incoming.get('language');
  if (language) formData.append('language', language);

  const response = await transcribe(formData);
  return json({ transcript: response.text || '' });
}
