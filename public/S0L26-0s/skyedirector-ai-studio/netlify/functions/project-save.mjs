import { getActor } from './_lib/auth.mjs';
import { saveProject } from './_lib/db.mjs';
import { bad, json, readJson } from './_lib/http.mjs';

export default async function handler(req, context) {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  const actor = getActor(req, context);
  const { project } = await readJson(req);
  if (!project?.id) return bad('Missing project payload');
  const saved = await saveProject(actor.id, project);
  return json({ ok: true, saved });
}
