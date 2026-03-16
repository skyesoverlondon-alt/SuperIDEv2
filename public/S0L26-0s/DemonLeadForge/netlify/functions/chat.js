import OpenAI from 'openai';
import { getStore } from '@netlify/blobs';
import { appendMessage, ensureDefaultProject, ensureSchema, ensureThread, logAudit, sql } from './_lib/db.js';
import { getNetlifyIdentity, json, noContent, unauthorized, badRequest, parseBody, serverError, makeId } from './_lib/http.js';
import { scrapeSite, leadsToCsv, mergeLeadRows } from './_lib/scrape.js';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const store = getStore({ name: 'leadforge-sheets', consistency: 'strong' });

function extractUrls(text = '') {
  const matches = String(text).match(/https?:\/\/[^\s)]+/g) || [];
  return [...new Set(matches.map((value) => value.replace(/[),.;]+$/, '')))];
}

function looksLikeCombineRequest(message = '') {
  return /\b(combine|merge|dedupe|merge these|combine these|make me a new sheet)\b/i.test(message);
}

function summarizeRows(rows = []) {
  const withEmail = rows.filter((row) => (row.emails || []).length).length;
  const withPhone = rows.filter((row) => (row.phones || []).length).length;
  const domains = [...new Set(rows.flatMap((row) => (row.websites || []).map((website) => {
    try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return null; }
  })).filter(Boolean))].slice(0, 20);
  return { rowCount: rows.length, withEmail, withPhone, domains };
}

function responseText(response) {
  if (response?.output_text) return response.output_text;
  const texts = [];
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.text) texts.push(part.text);
    }
  }
  return texts.join('\n').trim();
}

async function createSheetFromRows({ ownerIdentityUid, projectId, title, rows, sourceSummary, sourceUrls }) {
  const sheetId = makeId('sheet');
  const csv = leadsToCsv(rows);
  const blobJsonKey = `sheets/${sheetId}.json`;
  const blobCsvKey = `exports/${sheetId}.csv`;

  await store.setJSON(blobJsonKey, {
    sheetId,
    title,
    projectId,
    rows,
    createdAt: new Date().toISOString()
  });
  await store.set(blobCsvKey, csv, { metadata: { contentType: 'text/csv' } });

  await sql`
    INSERT INTO sheets (id, project_id, owner_identity_uid, title, source_summary, source_urls, row_count, blob_json_key, blob_csv_key)
    VALUES (
      ${sheetId},
      ${projectId},
      ${ownerIdentityUid},
      ${title},
      ${sourceSummary},
      ${JSON.stringify(sourceUrls || [])}::jsonb,
      ${rows.length},
      ${blobJsonKey},
      ${blobCsvKey}
    )
  `;

  for (const row of rows) {
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

  return {
    id: sheetId,
    project_id: projectId,
    title,
    row_count: rows.length,
    source_summary: sourceSummary,
    source_urls: sourceUrls,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) return unauthorized('Log in with Netlify Identity first.');
    if (!client) return serverError(new Error('OPENAI_API_KEY is not configured.'));

    const body = parseBody(event);
    const message = String(body.message || '').trim();
    if (!message) return badRequest('Missing message.');

    await ensureSchema();
    const project = body.projectId ? { id: body.projectId } : await ensureDefaultProject(user.sub);
    const thread = await ensureThread({
      ownerIdentityUid: user.sub,
      projectId: project.id,
      threadId: body.threadId || null,
      title: body.threadTitle || 'Lead Command Thread'
    });

    await appendMessage({ threadId: thread.id, role: 'user', content: message, metadata: { selectedSheetIds: body.selectedSheetIds || [] } });

    const actionResults = { scrapedSheets: [], combinedSheet: null };
    const selectedSheetIds = Array.isArray(body.selectedSheetIds) ? body.selectedSheetIds.filter(Boolean) : [];

    const history = await sql`
      SELECT role, content, metadata, created_at
      FROM messages
      WHERE thread_id = ${thread.id}
      ORDER BY created_at ASC
      LIMIT 20
    `;

    const selectedRows = selectedSheetIds.length
      ? await sql`
          SELECT s.id AS sheet_id, s.title AS sheet_title, l.business_name, l.contact_name, l.emails, l.phones, l.websites, l.address, l.page_title, l.source_url, l.notes
          FROM sheets s
          JOIN leads l ON l.sheet_id = s.id
          WHERE s.owner_identity_uid = ${user.sub}
            AND s.id = ANY(${selectedSheetIds})
        `
      : [];

    if (selectedSheetIds.length >= 2 && looksLikeCombineRequest(message)) {
      const mergedRows = mergeLeadRows(selectedRows.map((row) => ({
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

      actionResults.combinedSheet = await createSheetFromRows({
        ownerIdentityUid: user.sub,
        projectId: project.id,
        title: `AI Combined Sheet · ${new Date().toLocaleDateString('en-US')}`,
        rows: mergedRows,
        sourceSummary: `AI combined ${selectedSheetIds.length} selected sheets into ${mergedRows.length} deduped rows.`,
        sourceUrls: selectedSheetIds
      });

      await logAudit({
        actorIdentityUid: user.sub,
        eventType: 'chat_auto_combine',
        summary: `AI auto-combined sheets into ${actionResults.combinedSheet.id}`,
        payload: { sourceSheetIds: selectedSheetIds, createdSheetId: actionResults.combinedSheet.id }
      });
    }

    const urlTargets = extractUrls(message).slice(0, 2);
    if (urlTargets.length && /\b(scrape|crawl|pull|extract|lead|find contacts|collect)\b/i.test(message)) {
      for (const url of urlTargets) {
        const scraped = await scrapeSite({ url, maxPages: 8 });
        const sheet = await createSheetFromRows({
          ownerIdentityUid: user.sub,
          projectId: project.id,
          title: `AI Scrape · ${new URL(url).hostname}`,
          rows: scraped.leads,
          sourceSummary: `AI chat scrape of ${scraped.visitedCount} pages from ${new URL(url).hostname}.`,
          sourceUrls: [url]
        });
        actionResults.scrapedSheets.push({ sheet, stats: summarizeRows(scraped.leads), visitedCount: scraped.visitedCount });
      }

      await logAudit({
        actorIdentityUid: user.sub,
        eventType: 'chat_auto_scrape',
        summary: `AI auto-scraped ${actionResults.scrapedSheets.length} site(s) from chat`,
        payload: { urls: urlTargets, sheets: actionResults.scrapedSheets.map((entry) => entry.sheet.id) }
      });
    }

    const selectedSummary = summarizeRows(selectedRows.map((row) => ({
      emails: row.emails || [],
      phones: row.phones || [],
      websites: row.websites || []
    })));

    const prompt = [
      'You are Demon Lead Forge, a surgical lead intelligence copilot inside a Netlify/Neon command deck.',
      'Your job is to help the operator target, refine, dedupe, qualify, and organize public business leads.',
      'Do not hallucinate private data. Only discuss public-business lead workflows.',
      '',
      `Current user: ${user.email || user.sub}`,
      `Thread id: ${thread.id}`,
      `Selected sheets: ${selectedSheetIds.length}`,
      `Selected row summary: ${JSON.stringify(selectedSummary)}`,
      actionResults.combinedSheet ? `A new combined sheet was created: ${JSON.stringify(actionResults.combinedSheet)}` : 'No combined sheet was created in this turn.',
      actionResults.scrapedSheets.length ? `New scraped sheets created: ${JSON.stringify(actionResults.scrapedSheets)}` : 'No new scraped sheets were created in this turn.',
      '',
      'Recent conversation:',
      ...history.map((row) => `${row.role.toUpperCase()}: ${row.content}`),
      '',
      'Respond with tactical clarity. Include next moves, how to use the selected sheets, and where relevant suggest filtering, combining, or scraping patterns.',
      'Keep it concise but useful. No markdown table.'
    ].join('\n');

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.2-mini',
      input: prompt
    });

    const assistantText = responseText(response) || 'I processed the request, but the model returned no text. Try again with a tighter prompt.';

    await appendMessage({
      threadId: thread.id,
      role: 'assistant',
      content: assistantText,
      metadata: actionResults
    });

    return json(200, {
      ok: true,
      thread: {
        id: thread.id,
        title: thread.title
      },
      message: assistantText,
      actions: actionResults
    });
  } catch (error) {
    return serverError(error);
  }
};
