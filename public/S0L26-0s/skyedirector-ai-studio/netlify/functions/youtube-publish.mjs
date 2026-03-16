import { bad, json, readJson } from './_lib/http.mjs';
import { uploadVideoToYoutube } from './_lib/youtube.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const { base64, mimeType, title, description, tags, privacyStatus } = await readJson(req);
  if (!base64) return bad('Rendered video base64 is required.');
  if (!title) return bad('YouTube title is required.');
  const result = await uploadVideoToYoutube({
    base64,
    mimeType,
    title,
    description,
    tags: Array.isArray(tags) ? tags : [],
    privacyStatus: privacyStatus || 'private'
  });
  return json(result);
}
