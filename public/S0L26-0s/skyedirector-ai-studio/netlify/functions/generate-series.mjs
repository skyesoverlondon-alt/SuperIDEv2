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
  const payload = await readJson(req);
  const { goal, audience, tone, platforms, seriesAngle } = payload;
  if (!goal) return bad('Project goal is required');

  const system = [
    'You generate series maps for an AI-native creator studio.',
    'Return valid JSON only. No markdown. No commentary.',
    'The JSON must have this shape: {"summary":"...","episodes":[{"title":"...","objective":"...","hook":"...","summary":"...","thumbnailPrompt":"...","tags":["..."],"scenes":[{"title":"...","durationSec":4,"visualPrompt":"...","narration":"...","notes":"..."}]}] }',
    'Generate 6 episodes unless the goal strongly implies another count.'
  ].join(' ');

  const prompt = [
    `GOAL: ${goal}`,
    `AUDIENCE: ${audience || ''}`,
    `TONE: ${tone || ''}`,
    `PLATFORMS: ${(platforms || []).join(', ')}`,
    `SERIES ANGLE: ${seriesAngle || ''}`,
    'Make the series practical, educational, cinematic, and repurpose-friendly.',
    'Each episode must contain 4 to 6 scenes designed for a narrated storyboard export.'
  ].join('\n\n');

  const response = await createResponse({ system, prompt, temperature: 0.95 });
  const parsed = parseJsonFromModel(response.output_text);
  return json(parsed);
}
