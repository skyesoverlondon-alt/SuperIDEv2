import { ensureDefaultProject, ensureSchema, sql } from './_lib/db.js';
import { getNetlifyIdentity, json, noContent, unauthorized, serverError } from './_lib/http.js';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) return unauthorized('Log in with Netlify Identity first.');

    await ensureSchema();
    const project = await ensureDefaultProject(user.sub);

    const projects = await sql`
      SELECT id, title, description, created_at, updated_at
      FROM projects
      WHERE owner_identity_uid = ${user.sub}
      ORDER BY updated_at DESC, created_at DESC
    `;

    const sheets = await sql`
      SELECT id, project_id, title, source_summary, source_urls, row_count, created_at, updated_at
      FROM sheets
      WHERE owner_identity_uid = ${user.sub}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 50
    `;

    const threads = await sql`
      SELECT id, project_id, title, created_at, updated_at
      FROM threads
      WHERE owner_identity_uid = ${user.sub}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 50
    `;

    return json(200, {
      ok: true,
      currentProjectId: project.id,
      projects,
      sheets,
      threads
    });
  } catch (error) {
    return serverError(error);
  }
};
