import { stableStringify, sha256Hex, formatDuration, formatMoney, chunkLines, wrapLine, buildPdfFromLines } from './lib/core.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });

const text = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...headers
    }
  });

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-workspace-token'
};

const DEFAULT_WORKSPACE_ID = 'ws_default';

function nowIso() {
  return new Date().toISOString();
}

async function dbAll(env, sql, bindings = []) {
  const out = await env.DB.prepare(sql).bind(...bindings).all();
  return out.results || [];
}

async function dbFirst(env, sql, bindings = []) {
  return (await env.DB.prepare(sql).bind(...bindings).first()) || null;
}

async function dbRun(env, sql, bindings = []) {
  return env.DB.prepare(sql).bind(...bindings).run();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function ensureAuthed(request, env) {
  const required = env.API_SHARED_SECRET || '';
  if (!required) return null;
  const got = request.headers.get('x-workspace-token') || '';
  if (got && got === required) return null;
  return json({ ok: false, error: 'Unauthorized' }, 401, corsHeaders);
}

function withCors(response) {
  const out = new Response(response.body, response);
  Object.entries(corsHeaders).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 16);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 16);
  return [];
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = obj[key] ?? null;
    return acc;
  }, {});
}

async function ensureWorkspace(env) {
  await dbRun(env, `
    INSERT OR IGNORE INTO workspaces (id, slug, brand_name, logo_url, currency, timezone)
    VALUES (?, 'default', ?, ?, 'USD', ?)
  `, [DEFAULT_WORKSPACE_ID, env.BRAND_NAME || 'SkyeTime: Hour Logger', '/assets/img/skye-logo.png', env.DEFAULT_TIMEZONE || 'America/Phoenix']);
}

async function computeRecordHash(entityType, record) {
  return sha256Hex(stableStringify({ entityType, record }));
}

async function latestChainHash(env, workspaceId) {
  const row = await dbFirst(env, `SELECT chain_hash FROM audit_events WHERE workspace_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT 1`, [workspaceId]);
  return row?.chain_hash || 'GENESIS';
}

async function appendAuditEvent(env, workspaceId, entityType, entityId, action, occurredAt, payload) {
  const prevHash = await latestChainHash(env, workspaceId);
  const auditPayload = {
    entityType,
    entityId,
    action,
    occurredAt,
    payload
  };
  const chainHash = await sha256Hex(`${prevHash}|${stableStringify(auditPayload)}`);
  const id = uid('audit');
  await dbRun(env, `
    INSERT INTO audit_events (id, workspace_id, entity_type, entity_id, action, occurred_at, payload_json, prev_hash, chain_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, workspaceId, entityType, entityId, action, safeNumber(occurredAt, Date.now()), JSON.stringify(payload || {}), prevHash, chainHash, nowIso()]);
  return chainHash;
}

async function upsertTimeEntry(env, workspaceId, entry) {
  const sanitized = {
    id: String(entry.id || uid('tme')),
    title: String(entry.title || 'Work block').slice(0, 120),
    client_name: String(entry.client_name || '').slice(0, 120),
    project_name: String(entry.project_name || '').slice(0, 120),
    task_type: String(entry.task_type || '').slice(0, 80),
    started_at: safeNumber(entry.started_at, Date.now()),
    ended_at: entry.ended_at == null ? null : safeNumber(entry.ended_at, Date.now()),
    duration_seconds: safeNumber(entry.duration_seconds, 0),
    notes: String(entry.notes || '').slice(0, 8000),
    tags_json: JSON.stringify(normalizeTags(entry.tags)),
    status: String(entry.status || 'complete').slice(0, 32),
    device_id: String(entry.device_id || '').slice(0, 120),
    updated_at: String(entry.updated_at || nowIso()),
    created_at: String(entry.created_at || nowIso())
  };
  sanitized.record_hash = await computeRecordHash('time_entry', sanitized);
  await dbRun(env, `
    INSERT INTO time_entries (id, workspace_id, title, client_name, project_name, task_type, started_at, ended_at, duration_seconds, notes, tags_json, status, device_id, record_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      client_name=excluded.client_name,
      project_name=excluded.project_name,
      task_type=excluded.task_type,
      started_at=excluded.started_at,
      ended_at=excluded.ended_at,
      duration_seconds=excluded.duration_seconds,
      notes=excluded.notes,
      tags_json=excluded.tags_json,
      status=excluded.status,
      device_id=excluded.device_id,
      record_hash=excluded.record_hash,
      updated_at=excluded.updated_at
  `, [
    sanitized.id, workspaceId, sanitized.title, sanitized.client_name, sanitized.project_name, sanitized.task_type,
    sanitized.started_at, sanitized.ended_at, sanitized.duration_seconds, sanitized.notes, sanitized.tags_json,
    sanitized.status, sanitized.device_id, sanitized.record_hash, sanitized.created_at, sanitized.updated_at
  ]);
  await appendAuditEvent(env, workspaceId, 'time_entry', sanitized.id, 'upsert', sanitized.ended_at || sanitized.started_at, sanitized);
  return sanitized;
}

async function upsertNote(env, workspaceId, entry) {
  const sanitized = {
    id: String(entry.id || uid('note')),
    title: String(entry.title || 'Untitled note').slice(0, 140),
    body: String(entry.body || '').slice(0, 12000),
    tags_json: JSON.stringify(normalizeTags(entry.tags)),
    linked_time_entry_id: entry.linked_time_entry_id ? String(entry.linked_time_entry_id) : null,
    occurred_at: safeNumber(entry.occurred_at, Date.now()),
    updated_at: String(entry.updated_at || nowIso()),
    created_at: String(entry.created_at || nowIso())
  };
  sanitized.record_hash = await computeRecordHash('note', sanitized);
  await dbRun(env, `
    INSERT INTO notes (id, workspace_id, title, body, tags_json, linked_time_entry_id, occurred_at, record_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      body=excluded.body,
      tags_json=excluded.tags_json,
      linked_time_entry_id=excluded.linked_time_entry_id,
      occurred_at=excluded.occurred_at,
      record_hash=excluded.record_hash,
      updated_at=excluded.updated_at
  `, [sanitized.id, workspaceId, sanitized.title, sanitized.body, sanitized.tags_json, sanitized.linked_time_entry_id, sanitized.occurred_at, sanitized.record_hash, sanitized.created_at, sanitized.updated_at]);
  await appendAuditEvent(env, workspaceId, 'note', sanitized.id, 'upsert', sanitized.occurred_at, sanitized);
  return sanitized;
}

async function upsertLog(env, workspaceId, entry) {
  const sanitized = {
    id: String(entry.id || uid('log')),
    kind: String(entry.kind || 'log').slice(0, 80),
    title: String(entry.title || 'Activity').slice(0, 140),
    body: String(entry.body || '').slice(0, 8000),
    related_entity_type: entry.related_entity_type ? String(entry.related_entity_type) : null,
    related_entity_id: entry.related_entity_id ? String(entry.related_entity_id) : null,
    occurred_at: safeNumber(entry.occurred_at, Date.now()),
    updated_at: String(entry.updated_at || nowIso()),
    created_at: String(entry.created_at || nowIso())
  };
  sanitized.record_hash = await computeRecordHash('activity_log', sanitized);
  await dbRun(env, `
    INSERT INTO activity_logs (id, workspace_id, kind, title, body, occurred_at, related_entity_type, related_entity_id, record_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,
      title=excluded.title,
      body=excluded.body,
      occurred_at=excluded.occurred_at,
      related_entity_type=excluded.related_entity_type,
      related_entity_id=excluded.related_entity_id,
      record_hash=excluded.record_hash,
      updated_at=excluded.updated_at
  `, [sanitized.id, workspaceId, sanitized.kind, sanitized.title, sanitized.body, sanitized.occurred_at, sanitized.related_entity_type, sanitized.related_entity_id, sanitized.record_hash, sanitized.created_at, sanitized.updated_at]);
  await appendAuditEvent(env, workspaceId, 'activity_log', sanitized.id, 'upsert', sanitized.occurred_at, sanitized);
  return sanitized;
}

async function upsertExpense(env, workspaceId, entry) {
  const sanitized = {
    id: String(entry.id || uid('exp')),
    vendor: String(entry.vendor || '').slice(0, 160),
    amount_cents: safeNumber(entry.amount_cents, 0),
    currency: String(entry.currency || 'USD').slice(0, 8),
    category: String(entry.category || 'General').slice(0, 80),
    occurred_at: safeNumber(entry.occurred_at, Date.now()),
    notes: String(entry.notes || '').slice(0, 8000),
    receipt_object_key: entry.receipt_object_key ? String(entry.receipt_object_key) : null,
    receipt_sha256: entry.receipt_sha256 ? String(entry.receipt_sha256) : null,
    updated_at: String(entry.updated_at || nowIso()),
    created_at: String(entry.created_at || nowIso())
  };
  sanitized.record_hash = await computeRecordHash('expense', sanitized);
  await dbRun(env, `
    INSERT INTO expenses (id, workspace_id, vendor, amount_cents, currency, category, occurred_at, notes, receipt_object_key, receipt_sha256, record_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      vendor=excluded.vendor,
      amount_cents=excluded.amount_cents,
      currency=excluded.currency,
      category=excluded.category,
      occurred_at=excluded.occurred_at,
      notes=excluded.notes,
      receipt_object_key=excluded.receipt_object_key,
      receipt_sha256=excluded.receipt_sha256,
      record_hash=excluded.record_hash,
      updated_at=excluded.updated_at
  `, [sanitized.id, workspaceId, sanitized.vendor, sanitized.amount_cents, sanitized.currency, sanitized.category, sanitized.occurred_at, sanitized.notes, sanitized.receipt_object_key, sanitized.receipt_sha256, sanitized.record_hash, sanitized.created_at, sanitized.updated_at]);
  await appendAuditEvent(env, workspaceId, 'expense', sanitized.id, 'upsert', sanitized.occurred_at, sanitized);
  return sanitized;
}

async function snapshotWorkspace(env, workspaceId) {
  const [workspace, timeEntries, notes, logs, expenses, exportsRows, chain] = await Promise.all([
    dbFirst(env, `SELECT * FROM workspaces WHERE id = ?`, [workspaceId]),
    dbAll(env, `SELECT * FROM time_entries WHERE workspace_id = ? ORDER BY started_at DESC`, [workspaceId]),
    dbAll(env, `SELECT * FROM notes WHERE workspace_id = ? ORDER BY occurred_at DESC`, [workspaceId]),
    dbAll(env, `SELECT * FROM activity_logs WHERE workspace_id = ? ORDER BY occurred_at DESC`, [workspaceId]),
    dbAll(env, `SELECT * FROM expenses WHERE workspace_id = ? ORDER BY occurred_at DESC`, [workspaceId]),
    dbAll(env, `SELECT id, format, period_start, period_end, pdf_sha256, created_at FROM exports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20`, [workspaceId]),
    latestChainHash(env, workspaceId)
  ]);
  return {
    ok: true,
    workspace,
    proof_chain_head: chain,
    time_entries: timeEntries.map((row) => ({ ...row, tags: safeParse(row.tags_json, []) })),
    notes: notes.map((row) => ({ ...row, tags: safeParse(row.tags_json, []) })),
    activity_logs: logs,
    expenses,
    exports: exportsRows
  };
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function receiptUpload(env, body, workspaceId) {
  const expenseId = String(body.expenseId || uid('exp'));
  const dataUrl = String(body.dataUrl || '');
  if (!dataUrl.startsWith('data:image/')) return json({ ok: false, error: 'Invalid receipt image payload.' }, 400, corsHeaders);
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return json({ ok: false, error: 'Malformed receipt image.' }, 400, corsHeaders);
  const mime = match[1];
  const base64 = match[2];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const sha = await sha256Hex(bytes);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const key = `receipts/${workspaceId}/${expenseId}/${Date.now()}-${sha.slice(0, 12)}.${ext}`;
  await env.EVIDENCE_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { sha256: sha, workspaceId, expenseId }
  });
  return json({ ok: true, receipt_object_key: key, receipt_sha256: sha, expenseId }, 200, corsHeaders);
}

function pdfTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function isoDate(ms) {
  return new Date(ms).toISOString();
}

function buildExportLines(snapshot, rangeStart, rangeEnd, manifestHash, chainHead) {
  const lines = [];
  const timeEntries = snapshot.time_entries.filter((row) => row.started_at >= rangeStart && row.started_at <= rangeEnd);
  const notes = snapshot.notes.filter((row) => row.occurred_at >= rangeStart && row.occurred_at <= rangeEnd);
  const logs = snapshot.activity_logs.filter((row) => row.occurred_at >= rangeStart && row.occurred_at <= rangeEnd);
  const expenses = snapshot.expenses.filter((row) => row.occurred_at >= rangeStart && row.occurred_at <= rangeEnd);
  const totalSeconds = timeEntries.reduce((sum, row) => sum + safeNumber(row.duration_seconds), 0);
  const totalExpenseCents = expenses.reduce((sum, row) => sum + safeNumber(row.amount_cents), 0);

  const pushSection = (title) => {
    lines.push('');
    lines.push(title.toUpperCase());
    lines.push('-'.repeat(title.length));
  };

  lines.push(`Workspace: ${snapshot.workspace?.brand_name || 'SkyeTime: Hour Logger'}`);
  lines.push(`Range: ${isoDate(rangeStart)}  ->  ${isoDate(rangeEnd)}`);
  lines.push(`Manifest SHA-256: ${manifestHash}`);
  lines.push(`Proof Chain Head: ${chainHead}`);
  lines.push(`Total Logged Time: ${formatDuration(totalSeconds)} (${(totalSeconds / 3600).toFixed(2)} hours)`);
  lines.push(`Total Expenses: ${formatMoney(totalExpenseCents, snapshot.workspace?.currency || 'USD')}`);
  lines.push(`Time Entries: ${timeEntries.length} | Notes: ${notes.length} | Logs: ${logs.length} | Expenses: ${expenses.length}`);

  pushSection('Time Entries');
  if (!timeEntries.length) lines.push('No time entries in range.');
  timeEntries.forEach((row, index) => {
    const tags = Array.isArray(row.tags) && row.tags.length ? ` | Tags: ${row.tags.join(', ')}` : '';
    const block = [
      `${index + 1}. ${row.title}`,
      `   Started: ${isoDate(row.started_at)} | Ended: ${row.ended_at ? isoDate(row.ended_at) : 'running'} | Duration: ${formatDuration(row.duration_seconds)}`,
      `   Client: ${row.client_name || '—'} | Project: ${row.project_name || '—'} | Type: ${row.task_type || '—'}${tags}`,
      `   Record Hash: ${row.record_hash}`,
      `   Notes: ${row.notes || '—'}`
    ];
    block.forEach((line) => wrapLine(line).forEach((wrapped) => lines.push(wrapped)));
    lines.push('');
  });

  pushSection('Notes');
  if (!notes.length) lines.push('No notes in range.');
  notes.forEach((row, index) => {
    const block = [
      `${index + 1}. ${row.title} @ ${isoDate(row.occurred_at)}`,
      `   Record Hash: ${row.record_hash}`,
      `   Linked Session: ${row.linked_time_entry_id || '—'}`,
      `   ${row.body || '—'}`
    ];
    block.forEach((line) => wrapLine(line).forEach((wrapped) => lines.push(wrapped)));
    lines.push('');
  });

  pushSection('Operator Log');
  if (!logs.length) lines.push('No activity logs in range.');
  logs.forEach((row, index) => {
    const block = [
      `${index + 1}. [${row.kind}] ${row.title} @ ${isoDate(row.occurred_at)}`,
      `   Record Hash: ${row.record_hash}`,
      `   Related: ${row.related_entity_type || '—'} / ${row.related_entity_id || '—'}`,
      `   ${row.body || '—'}`
    ];
    block.forEach((line) => wrapLine(line).forEach((wrapped) => lines.push(wrapped)));
    lines.push('');
  });

  pushSection('Expenses');
  if (!expenses.length) lines.push('No expenses in range.');
  expenses.forEach((row, index) => {
    const block = [
      `${index + 1}. ${row.vendor || 'Expense'} @ ${isoDate(row.occurred_at)}`,
      `   Amount: ${formatMoney(row.amount_cents, row.currency || 'USD')} | Category: ${row.category || 'General'}`,
      `   Receipt SHA-256: ${row.receipt_sha256 || 'No receipt attached'} | Receipt Key: ${row.receipt_object_key || '—'}`,
      `   Record Hash: ${row.record_hash}`,
      `   Notes: ${row.notes || '—'}`
    ];
    block.forEach((line) => wrapLine(line).forEach((wrapped) => lines.push(wrapped)));
    lines.push('');
  });

  return lines;
}

async function exportPdf(env, body, workspaceId) {
  const rangeStart = safeNumber(body.rangeStart, Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rangeEnd = safeNumber(body.rangeEnd, Date.now());
  const snapshot = await snapshotWorkspace(env, workspaceId);
  const manifestPayload = {
    workspaceId,
    rangeStart,
    rangeEnd,
    proof_chain_head: snapshot.proof_chain_head,
    counts: {
      time_entries: snapshot.time_entries.filter((row) => row.started_at >= rangeStart && row.started_at <= rangeEnd).length,
      notes: snapshot.notes.filter((row) => row.occurred_at >= rangeStart && row.occurred_at <= rangeEnd).length,
      activity_logs: snapshot.activity_logs.filter((row) => row.occurred_at >= rangeStart && row.occurred_at <= rangeEnd).length,
      expenses: snapshot.expenses.filter((row) => row.occurred_at >= rangeStart && row.occurred_at <= rangeEnd).length
    }
  };
  const manifestHash = await sha256Hex(stableStringify(manifestPayload));
  const lines = buildExportLines(snapshot, rangeStart, rangeEnd, manifestHash, snapshot.proof_chain_head);
  const pages = chunkLines(lines, 46);
  const generatedAt = nowIso();
  const pdfBytes = buildPdfFromLines(pages, {
    title: snapshot.workspace?.brand_name || 'SkyeTime: Hour Logger',
    subtitle: `Proof export • ${new Date(rangeStart).toLocaleDateString('en-US')} to ${new Date(rangeEnd).toLocaleDateString('en-US')}`,
    generatedAt,
    creationDatePdf: pdfTimestamp(new Date(generatedAt)),
    author: 'Skyes Over London LC'
  });
  const pdfSha = await sha256Hex(pdfBytes);
  const exportId = uid('export');
  const key = `exports/${workspaceId}/${exportId}-${pdfSha.slice(0, 12)}.pdf`;
  await env.EVIDENCE_BUCKET.put(key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: {
      exportId,
      manifestSha256: manifestHash,
      pdfSha256: pdfSha,
      workspaceId
    }
  });
  await dbRun(env, `
    INSERT INTO exports (id, workspace_id, format, period_start, period_end, pdf_object_key, pdf_sha256, manifest_json, created_at)
    VALUES (?, ?, 'pdf', ?, ?, ?, ?, ?, ?)
  `, [exportId, workspaceId, rangeStart, rangeEnd, key, pdfSha, JSON.stringify({ ...manifestPayload, manifest_sha256: manifestHash, generatedAt }), generatedAt]);
  await appendAuditEvent(env, workspaceId, 'export', exportId, 'pdf_export', Date.now(), { manifest_sha256: manifestHash, pdf_sha256: pdfSha, rangeStart, rangeEnd });
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="skyetime-proof-${new Date(rangeStart).toISOString().slice(0, 10)}-${pdfSha.slice(0, 8)}.pdf"`,
      'x-skyetime-manifest-sha256': manifestHash,
      'x-skyetime-pdf-sha256': pdfSha,
      'x-skyetime-proof-chain-head': snapshot.proof_chain_head
    }
  });
}

async function downloadExport(env, workspaceId, exportId) {
  const row = await dbFirst(env, `SELECT * FROM exports WHERE workspace_id = ? AND id = ?`, [workspaceId, exportId]);
  if (!row) return json({ ok: false, error: 'Export not found.' }, 404, corsHeaders);
  const object = await env.EVIDENCE_BUCKET.get(row.pdf_object_key);
  if (!object) return json({ ok: false, error: 'Export asset missing.' }, 404, corsHeaders);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-disposition', `attachment; filename="skyetime-proof-${row.id}.pdf"`);
  headers.set('x-skyetime-pdf-sha256', row.pdf_sha256 || '');
  Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  return new Response(object.body, { headers });
}

async function handleRequest(request, env) {
  await ensureWorkspace(env);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const counts = {
      time_entries: safeNumber((await dbFirst(env, `SELECT COUNT(*) as count FROM time_entries`, []))?.count, 0),
      expenses: safeNumber((await dbFirst(env, `SELECT COUNT(*) as count FROM expenses`, []))?.count, 0),
      notes: safeNumber((await dbFirst(env, `SELECT COUNT(*) as count FROM notes`, []))?.count, 0)
    };
    return json({
      ok: true,
      app: 'SkyeTime: Hour Logger',
      runtime: 'cloudflare-workers',
      storage: { d1: true, r2: true },
      counts,
      timestamp: nowIso()
    }, 200, corsHeaders);
  }

  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    return json(await snapshotWorkspace(env, DEFAULT_WORKSPACE_ID), 200, corsHeaders);
  }

  if (request.method === 'GET' && url.pathname === '/api/exports') {
    const auth = ensureAuthed(request, env); if (auth) return auth;
    const rows = await dbAll(env, `SELECT id, format, period_start, period_end, pdf_sha256, created_at FROM exports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`, [DEFAULT_WORKSPACE_ID]);
    return json({ ok: true, exports: rows }, 200, corsHeaders);
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/exports/')) {
    const auth = ensureAuthed(request, env); if (auth) return auth;
    const exportId = url.pathname.split('/').pop();
    return downloadExport(env, DEFAULT_WORKSPACE_ID, exportId);
  }

  if (request.method === 'POST' && url.pathname === '/api/sync/batch') {
    const auth = ensureAuthed(request, env); if (auth) return auth;
    const body = await readJson(request);
    const workspaceId = String(body.workspaceId || DEFAULT_WORKSPACE_ID);
    const timeEntries = Array.isArray(body.time_entries) ? body.time_entries : [];
    const notes = Array.isArray(body.notes) ? body.notes : [];
    const logs = Array.isArray(body.activity_logs) ? body.activity_logs : [];
    const expenses = Array.isArray(body.expenses) ? body.expenses : [];

    const out = { ok: true, synced: { time_entries: [], notes: [], activity_logs: [], expenses: [] } };
    for (const item of timeEntries) out.synced.time_entries.push(await upsertTimeEntry(env, workspaceId, item));
    for (const item of notes) out.synced.notes.push(await upsertNote(env, workspaceId, item));
    for (const item of logs) out.synced.activity_logs.push(await upsertLog(env, workspaceId, item));
    for (const item of expenses) out.synced.expenses.push(await upsertExpense(env, workspaceId, item));

    out.proof_chain_head = await latestChainHash(env, workspaceId);
    out.server_time = nowIso();
    return json(out, 200, corsHeaders);
  }

  if (request.method === 'POST' && url.pathname === '/api/uploads/receipt') {
    const auth = ensureAuthed(request, env); if (auth) return auth;
    const body = await readJson(request);
    return receiptUpload(env, body, String(body.workspaceId || DEFAULT_WORKSPACE_ID));
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/pdf') {
    const auth = ensureAuthed(request, env); if (auth) return auth;
    const body = await readJson(request);
    return exportPdf(env, body, String(body.workspaceId || DEFAULT_WORKSPACE_ID));
  }

  if (request.method === 'POST' && url.pathname === '/api/workspace') {
    const auth = ensureAuthed(request, env); if (auth) return auth;
    const body = await readJson(request);
    const brandName = String(body.brand_name || env.BRAND_NAME || 'SkyeTime: Hour Logger').slice(0, 120);
    const timezone = String(body.timezone || env.DEFAULT_TIMEZONE || 'America/Phoenix').slice(0, 80);
    const currency = String(body.currency || 'USD').slice(0, 8);
    await dbRun(env, `
      UPDATE workspaces
      SET brand_name = ?, timezone = ?, currency = ?
      WHERE id = ?
    `, [brandName, timezone, currency, DEFAULT_WORKSPACE_ID]);
    await appendAuditEvent(env, DEFAULT_WORKSPACE_ID, 'workspace', DEFAULT_WORKSPACE_ID, 'settings_update', Date.now(), { brandName, timezone, currency });
    return json(await snapshotWorkspace(env, DEFAULT_WORKSPACE_ID), 200, corsHeaders);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return withCors(await handleRequest(request, env));
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: error.message || 'Unhandled error' }, 500, corsHeaders);
    }
  }
};
