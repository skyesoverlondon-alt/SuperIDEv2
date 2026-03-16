import { getStore } from '@netlify/blobs';
import { ensureDefaultProject, ensureSchema, logAudit, sql } from './_lib/db.js';
import { getNetlifyIdentity, json, noContent, unauthorized, badRequest, parseBody, serverError, makeId } from './_lib/http.js';
import { scrapeSite, leadsToCsv } from './_lib/scrape.js';

const store = getStore({ name: 'leadforge-sheets', consistency: 'strong' });

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) return unauthorized('Log in with Netlify Identity first.');

    const body = parseBody(event);
    const targetUrl = body.url || '';
    const maxPages = Math.min(Math.max(Number(body.maxPages || 12), 1), 30);
    if (!targetUrl) return badRequest('Missing url.');

    await ensureSchema();
    const project = body.projectId
      ? { id: body.projectId }
      : await ensureDefaultProject(user.sub);

    await logAudit({
      actorIdentityUid: user.sub,
      eventType: 'scrape_started',
      summary: `Scrape started for ${targetUrl}`,
      payload: { url: targetUrl, maxPages, projectId: project.id }
    });

    const scrapeResult = await scrapeSite({ url: targetUrl, maxPages });
    const sheetId = makeId('sheet');
    const title = body.title || `Leads · ${new URL(targetUrl).hostname}`;
    const csv = leadsToCsv(scrapeResult.leads);
    const blobJsonKey = `sheets/${sheetId}.json`;
    const blobCsvKey = `exports/${sheetId}.csv`;

    await store.setJSON(blobJsonKey, {
      sheetId,
      title,
      projectId: project.id,
      scrapeResult,
      createdAt: new Date().toISOString()
    });
    await store.set(blobCsvKey, csv, { metadata: { contentType: 'text/csv' } });

    await sql`
      INSERT INTO sheets (id, project_id, owner_identity_uid, title, source_summary, source_urls, row_count, blob_json_key, blob_csv_key)
      VALUES (
        ${sheetId},
        ${project.id},
        ${user.sub},
        ${title},
        ${`Scraped ${scrapeResult.visitedCount} pages from ${new URL(targetUrl).hostname}`},
        ${JSON.stringify([targetUrl])}::jsonb,
        ${scrapeResult.leads.length},
        ${blobJsonKey},
        ${blobCsvKey}
      )
    `;

    for (const row of scrapeResult.leads) {
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
      eventType: 'scrape_completed',
      summary: `Scrape completed for ${targetUrl} with ${scrapeResult.leads.length} rows`,
      payload: { url: targetUrl, sheetId, leads: scrapeResult.leads.length, errors: scrapeResult.errors.length }
    });

    return json(200, {
      ok: true,
      sheet: {
        id: sheetId,
        project_id: project.id,
        title,
        row_count: scrapeResult.leads.length,
        source_summary: `Scraped ${scrapeResult.visitedCount} pages from ${new URL(targetUrl).hostname}`,
        source_urls: [targetUrl],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      scrape: {
        visitedCount: scrapeResult.visitedCount,
        errorCount: scrapeResult.errors.length,
        pages: scrapeResult.pages.slice(0, 20),
        leadsPreview: scrapeResult.leads.slice(0, 25)
      }
    });
  } catch (error) {
    return serverError(error);
  }
};
