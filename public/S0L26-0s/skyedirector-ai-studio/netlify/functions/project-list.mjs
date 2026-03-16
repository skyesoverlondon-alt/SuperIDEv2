import { getActor } from './_lib/auth.mjs';
import { listProjects } from './_lib/db.mjs';
import { json } from './_lib/http.mjs';

export default async function handler(req, context) {
  const actor = getActor(req, context);
  const projects = await listProjects(actor.id);
  return json({ projects: projects || [] });
}
