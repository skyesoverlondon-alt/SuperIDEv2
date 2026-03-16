import { bad, json, readJson } from './_lib/http.mjs';
import { renderTimelineMp4 } from './_lib/render.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const payload = await readJson(req);
  if (!payload?.timeline?.tracks?.length) return bad('Timeline payload is required.');
  const rendered = await renderTimelineMp4(payload);
  return json(rendered);
}
