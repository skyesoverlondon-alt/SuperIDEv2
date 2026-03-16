import { readJson } from './_lib/http.mjs';
import { renderTimelineMp4 } from './_lib/render.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const payload = await readJson(req);
  if (!payload?.timeline?.tracks?.length) return new Response('Timeline payload is required.', { status: 400 });
  try {
    const rendered = await renderTimelineMp4(payload);
    console.log('Background render completed', {
      filename: rendered.filename,
      bytes: rendered.videoBase64.length
    });
  } catch (error) {
    console.error('Background render failed', error);
  }
}
