import { getStore } from '@netlify/blobs';
import { ensureDefaultProject, ensureSchema, logAudit, sql } from './_lib/db.js';
import { getNetlifyIdentity, json, noContent, unauthorized, badRequest, parseBody, serverError, makeId } from './_lib/http.js';
import { leadsToCsv, mergeLeadRows } from './_lib/scrape.js';

const store = getStore({ name: 'leadforge-sheets', consistency: 'strong' });

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) return unauthorized('Log in with Netlify Identity first.');

    const body = parseBody(event);
    const sourceSheetIds = Array.isArray(body.sourceSheetIds) ? body.sourceSheetIds.filter(Boolean) : [];
    if (sourceSheetIds.length < 2) return badRequest('Pick at least two sheets to combine.');

    await ensureSchema();
    const project = body.projectId ? { id: body.projectId } : await ensureDefaultProject(user.sub);

    const sheetRows = await sql`
      SELECT s.id AS sheet_id, s.title AS sheet_title, l.business_name, l.contact_name, l.emails, l.phones, l.websites, l.address, l.page_title, l.source_url, l.notes
      FROM sheets s
      JOIN leads l ON l.sheet_id = s.id
      WHERE s.owner_identity_uid = ${user.sub}
        AND s.id = ANY(${sourceSheetIds})
    `;

    if (!sheetRows.length) return badRequest('No rows found in the selected sheets.');

    const mergedRows = mergeLeadRows(sheetRows.map((row) => ({
      business_name: row.business_name,
      contact_name: row.contact_name,
      emails: row.emails || [],
      phones: row.phones || [],
      websites: row.websites || [],
      address: row.address,
      page_title: row.page_title,
      source_url: row.source_url,
      notes: row.notes
    })));

    const sheetId = makeId('sheet');
    const title = body.title || `Combined Sheet · ${new Date().toLocaleDateString('en-US')}`;
    const csv = leadsToCsv(mergedRows);
    const blobJsonKey = `sheets/${sheetId}.json`;
    const blobCsvKey = `exports/${sheetId}.csv`;

    await store.setJSON(blobJsonKey, { sheetId, title, projectId: project.id, rows: mergedRows, sourceSheetIds });
    await store.set(blobCsvKey, csv, { metadata: { contentType: 'text/csv' } });

    await sql`
      INSERT INTO sheets (id, project_id, owner_identity_uid, title, source_summary, source_urls, row_count, blob_json_key, blob_csv_key)
      VALUES (
        ${sheetId},
        ${project.id},
        ${user.sub},
        ${title},
        ${`Combined ${sourceSheetIds.length} sheets into ${mergedRows.length} deduped rows.`},
        ${JSON.stringify(sourceSheetIds)}::jsonb,
        ${mergedRows.length},
        ${blobJsonKey},
        ${blobCsvKey}
      )
    `;

    for (const row of mergedRows) {
      await sql`
        INSERT INTO leads (id, sheet_id, business_name, contact_name, emails, phones, websites, address, page_title, source_url, notes, raw_json)
        VALUES (
          ${makeId('lead')},
          ${sheetId},
          ${row.business_name || ''},
          ${row.contact_name || ''},
          ${JSON.stringify(row.emails || [])}::jsonb,
          ${JSON.stringify(row.phones || [])}::jsonb,
          ${JSON.stringify(row.websites || [])}::jsonb,
          ${row.address || ''},
          ${row.page_title || ''},
          ${row.source_url || ''},
          ${row.notes || ''},
          ${JSON.stringify(row)}::jsonb
        )
      `;
    }

    await logAudit({
      actorIdentityUid: user.sub,
      eventType: 'sheet_combined',
      summary: `Combined ${sourceSheetIds.length} sheets into ${sheetId}`,
      payload: { sourceSheetIds, createdSheetId: sheetId, rowCount: mergedRows.length }
    });

    return json(200, {
      ok: true,
      sheet: {
        id: sheetId,
        project_id: project.id,
        title,
        row_count: mergedRows.length,
        source_summary: `Combined ${sourceSheetIds.length} sheets into ${mergedRows.length} deduped rows.`,
        source_urls: sourceSheetIds,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return serverError(error);
  }
};
