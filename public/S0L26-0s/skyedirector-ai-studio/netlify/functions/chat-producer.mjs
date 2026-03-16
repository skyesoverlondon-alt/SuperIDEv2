import { bad, json, readJson } from './_lib/http.mjs';
import { createResponse } from './_lib/openai.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const { project, episode, message } = await readJson(req);
  if (!message) return bad('Message is required');

  const system = [
    'You are the producer brain inside SkyeDirector AI Studio by Skyes Over London.',
    'Be sharp, creative, practical, and ruthless about clarity.',
    'Help the user make educational, cinematic, platform-aware video content.',
    'Never answer with vague platitudes. Give concrete recommendations the editor can act on right now.',
    'Return plain text only.'
  ].join(' ');

  const prompt = [
    `PROJECT TITLE: ${project?.title || 'Untitled'}`,
    `GOAL: ${project?.goal || ''}`,
    `AUDIENCE: ${project?.audience || ''}`,
    `TONE: ${project?.tone || ''}`,
    `SERIES ANGLE: ${project?.seriesAngle || ''}`,
    `PLATFORMS: ${(project?.platforms || []).join(', ')}`,
    `ACTIVE EPISODE: ${episode?.title || ''}`,
    `ACTIVE EPISODE OBJECTIVE: ${episode?.objective || ''}`,
    `ACTIVE EPISODE HOOK: ${episode?.hook || ''}`,
    `USER REQUEST: ${message}`,
    'Respond as a producer and editor. Use short paragraphs and concrete actions.'
  ].join('\n\n');

  const response = await createResponse({ system, prompt, temperature: 0.9 });
  return json({ reply: response.output_text || 'No producer reply returned.' });
}
