import { getStore } from '@netlify/blobs';
import { ensureSchema, sql } from './_lib/db.js';
import { getNetlifyIdentity, noContent, unauthorized, badRequest, serverError, getQuery } from './_lib/http.js';

const store = getStore({ name: 'leadforge-sheets', consistency: 'strong' });

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Method not allowed.'
    };
  }

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) return unauthorized('Log in with Netlify Identity first.');

    const { sheetId } = getQuery(event);
    if (!sheetId) return badRequest('Missing sheetId.');

    await ensureSchema();
    const result = await sql`
      SELECT title, blob_csv_key
      FROM sheets
      WHERE id = ${sheetId} AND owner_identity_uid = ${user.sub}
      LIMIT 1
    `;
    if (!result.length) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: 'Sheet not found.'
      };
    }

    const sheet = result[0];
    const csv = await store.get(sheet.blob_csv_key, { type: 'text' });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${(sheet.title || 'sheet').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv"`
      },
      body: csv || ''
    };
  } catch (error) {
    return serverError(error);
  }
};
