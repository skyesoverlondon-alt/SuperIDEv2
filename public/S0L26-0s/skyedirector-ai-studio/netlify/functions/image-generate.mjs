import { bad, json, readJson } from './_lib/http.mjs';
import { generateImage } from './_lib/openai.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const { prompt, size } = await readJson(req);
  if (!prompt) return bad('Prompt is required');
  const response = await generateImage({ prompt, size });
  const imageBase64 = response?.data?.[0]?.b64_json;
  if (!imageBase64) return bad('No image returned from model', 502);
  return json({ imageBase64, mimeType: 'image/png' });
}
