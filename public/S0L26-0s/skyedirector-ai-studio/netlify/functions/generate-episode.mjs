import { bad, json, readJson } from './_lib/http.mjs';
import { createResponse } from './_lib/openai.mjs';

function parseJsonFromModel(text) {
  const cleaned = String(text || '').trim();
  const fence = cleaned.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : cleaned;
  return JSON.parse(raw);
}

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const { project, episode } = await readJson(req);
  if (!episode?.title) return bad('Episode title is required');

  const system = [
    'You build one episode production packet for SkyeDirector AI Studio.',
    'Return valid JSON only. No markdown fences unless forced.',
    'Required JSON shape: {"objective":"...","hook":"...","summary":"...","script":"...","description":"...","tags":["..."],"thumbnailPrompt":"...","shotList":["..."],"scenes":[{"title":"...","durationSec":4,"visualPrompt":"...","narration":"...","notes":"..."}]}'
  ].join(' ');

  const prompt = [
    `PROJECT TITLE: ${project?.title || ''}`,
    `GOAL: ${project?.goal || ''}`,
    `AUDIENCE: ${project?.audience || ''}`,
    `TONE: ${project?.tone || ''}`,
    `SERIES ANGLE: ${project?.seriesAngle || ''}`,
    `PLATFORMS: ${(project?.platforms || []).join(', ')}`,
    `EPISODE TITLE: ${episode?.title}`,
    `CURRENT OBJECTIVE: ${episode?.objective || ''}`,
    `CURRENT HOOK: ${episode?.hook || ''}`,
    `CURRENT SUMMARY: ${episode?.summary || ''}`,
    'Build a clean educational script, a platform-ready description, 8 to 12 tags, a thumbnail prompt, a shot list, and 4 to 7 storyboard scenes.',
    'Every scene must be compatible with a narrated storyboard reel and contain visualPrompt plus narration.'
  ].join('\n\n');

  const response = await createResponse({ system, prompt, temperature: 0.9 });
  const parsed = parseJsonFromModel(response.output_text);
  return json(parsed);
}
