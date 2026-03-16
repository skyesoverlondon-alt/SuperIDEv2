import { ensureSchema, sql } from './_lib/db.js';
import { getNetlifyIdentity, json, noContent, unauthorized, badRequest, getQuery, serverError } from './_lib/http.js';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) return unauthorized('Log in with Netlify Identity first.');

    const { sheetId } = getQuery(event);
    if (!sheetId) return badRequest('Missing sheetId.');

    await ensureSchema();
    const sheets = await sql`
      SELECT id, project_id, title, source_summary, source_urls, row_count, blob_json_key, blob_csv_key, created_at, updated_at
      FROM sheets
      WHERE id = ${sheetId} AND owner_identity_uid = ${user.sub}
      LIMIT 1
    `;
    if (!sheets.length) return json(404, { ok: false, error: 'Sheet not found.' });

    const rows = await sql`
      SELECT id, business_name, contact_name, emails, phones, websites, address, page_title, source_url, notes, created_at
      FROM leads
      WHERE sheet_id = ${sheetId}
      ORDER BY business_name ASC NULLS LAST, created_at ASC
    `;

    return json(200, { ok: true, sheet: sheets[0], rows });
  } catch (error) {
    return serverError(error);
  }
};
