const DB_NAME = 'skyetime-hour-logger';
const DB_VERSION = 1;
const STORE_NAMES = ['time_entries', 'notes', 'activity_logs', 'expenses', 'settings', 'meta', 'exports'];
const WORKSPACE_ID = 'ws_default';

const state = {
  db: null,
  workspace: {
    id: WORKSPACE_ID,
    brand_name: 'SkyeTime: Hour Logger',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Phoenix',
    currency: 'USD'
  },
  proofChainHead: 'GENESIS',
  timer: null,
  draftReceipt: null,
  syncInFlight: false,
  initialized: false,
  isOnline: navigator.onLine,
  filterText: {
    sessions: '',
    notes: '',
    expenses: ''
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isoFromLocalDateTime(value) {
  return value ? new Date(value).toISOString() : nowIso();
}

function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatHours(seconds = 0) {
  return `${(Number(seconds || 0) / 3600).toFixed(2)}h`;
}

function formatMoney(cents = 0, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((Number(cents) || 0) / 100);
}

function formatDateTime(msOrIso) {
  const date = new Date(msOrIso);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function setStatus(el, text, tone = 'default') {
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function showMessage(text, tone = 'default') {
  const syncPill = $('#sync-pill');
  setStatus(syncPill, text, tone);
  if (tone !== 'working') {
    clearTimeout(showMessage._timer);
    showMessage._timer = setTimeout(() => {
      if (!state.syncInFlight) setStatus(syncPill, 'Sync idle', 'default');
    }, 2600);
  }
}

function todayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000 - 1;
  return [start, end];
}

function weekStartMs() {
  const now = new Date();
  const day = now.getDay();
  const diff = (day + 6) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function toDateInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalDateTimeValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

async function recordLocalHash(type, record) {
  return sha256Hex(stableStringify({ type, record }));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORE_NAMES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return state.db.transaction(storeName, mode).objectStore(storeName);
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, 'readwrite').put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function idbBulkPut(storeName, values) {
  return Promise.all(values.map((value) => idbPut(storeName, value)));
}

async function getSettings() {
  return (await idbGet('settings', 'workspace_settings')) || {
    id: 'workspace_settings',
    brand_name: state.workspace.brand_name,
    timezone: state.workspace.timezone,
    currency: state.workspace.currency,
    token: ''
  };
}

async function saveSettingsLocal(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial, id: 'workspace_settings', updated_at: nowIso() };
  await idbPut('settings', merged);
  return merged;
}

async function getActiveTimer() {
  return idbGet('meta', 'active_timer');
}

async function saveActiveTimer(timer) {
  await idbPut('meta', { id: 'active_timer', ...timer });
}

async function clearActiveTimer() {
  return new Promise((resolve, reject) => {
    const request = tx('meta', 'readwrite').delete('active_timer');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function listStore(storeName) {
  const all = await idbGetAll(storeName);
  return all.sort((a, b) => {
    const left = a.occurred_at || a.started_at || Date.parse(a.updated_at || a.created_at || 0);
    const right = b.occurred_at || b.started_at || Date.parse(b.updated_at || b.created_at || 0);
    return right - left;
  });
}

async function localSnapshot() {
  const [time_entries, notes, activity_logs, expenses, exports, settings] = await Promise.all([
    listStore('time_entries'),
    listStore('notes'),
    listStore('activity_logs'),
    listStore('expenses'),
    listStore('exports'),
    getSettings()
  ]);
  state.workspace = { ...state.workspace, ...settings };
  return { time_entries, notes, activity_logs, expenses, exports };
}

async function fetchJson(url, options = {}) {
  const settings = await getSettings();
  const headers = new Headers(options.headers || {});
  if (!headers.has('content-type') && options.body) headers.set('content-type', 'application/json');
  if (settings.token) headers.set('x-workspace-token', settings.token);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.error || detail;
    } catch {}
    throw new Error(detail || 'Request failed');
  }
  return response.json();
}

function mergeServerRow(localRows, serverRow) {
  const existing = localRows.find((row) => row.id === serverRow.id);
  if (!existing) return serverRow;
  const localUpdated = Date.parse(existing.updated_at || existing.created_at || 0);
  const serverUpdated = Date.parse(serverRow.updated_at || serverRow.created_at || 0);
  return localUpdated > serverUpdated && existing._dirty ? existing : { ...existing, ...serverRow, _dirty: false };
}

async function bootstrapFromServer() {
  if (!navigator.onLine) return;
  try {
    const data = await fetchJson('/api/bootstrap');
    state.workspace = { ...state.workspace, ...data.workspace };
    state.proofChainHead = data.proof_chain_head || state.proofChainHead;
    $('#chain-pill').textContent = `Proof ${state.proofChainHead.slice(0, 12)}…`;
    const serverSets = {
      time_entries: data.time_entries || [],
      notes: data.notes || [],
      activity_logs: data.activity_logs || [],
      expenses: data.expenses || [],
      exports: data.exports || []
    };

    for (const [storeName, rows] of Object.entries(serverSets)) {
      const localRows = await listStore(storeName);
      const merged = rows.map((row) => mergeServerRow(localRows, row));
      const localOnlyDirty = localRows.filter((row) => row._dirty && !rows.some((srv) => srv.id === row.id));
      await idbBulkPut(storeName, [...merged, ...localOnlyDirty]);
    }

    await saveSettingsLocal({
      brand_name: state.workspace.brand_name,
      timezone: state.workspace.timezone,
      currency: state.workspace.currency
    });
  } catch (error) {
    console.warn('bootstrap fallback', error);
    showMessage(`Offline/local mode: ${error.message}`, 'warning');
  }
}

async function renderAll() {
  const snapshot = await localSnapshot();
  const { time_entries, notes, activity_logs, expenses, exports } = snapshot;

  renderTimer();
  renderMetrics(time_entries, expenses);
  renderTodayTimeline(time_entries, notes, activity_logs, expenses);
  renderSessions(time_entries);
  renderNotes(notes);
  renderLogs(activity_logs);
  renderExpenses(expenses);
  renderExports(exports);
  renderSettings();
  updatePendingCount(time_entries, notes, activity_logs, expenses);
}

function renderTimer() {
  const active = state.timer;
  const display = $('#timer-display');
  const label = $('#active-session-label');
  const startBtn = $('#start-timer');
  const stopBtn = $('#stop-timer');
  if (!active) {
    display.textContent = '00:00:00';
    label.textContent = 'No session running';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }
  const elapsedSeconds = Math.floor((Date.now() - active.started_at) / 1000);
  display.textContent = formatDuration(elapsedSeconds);
  label.textContent = `${active.title || 'Active work block'} • started ${formatDateTime(active.started_at)}`;
  startBtn.disabled = true;
  stopBtn.disabled = false;
}

function renderMetrics(timeEntries, expenses) {
  const [todayStart, todayEnd] = todayBounds();
  const weekStart = weekStartMs();
  const todaySeconds = timeEntries.filter((row) => row.started_at >= todayStart && row.started_at <= todayEnd).reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0);
  const weekSeconds = timeEntries.filter((row) => row.started_at >= weekStart).reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0);
  const weekExpenseCents = expenses.filter((row) => row.occurred_at >= weekStart).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  $('#metric-today-hours').textContent = formatHours(todaySeconds);
  $('#metric-week-hours').textContent = formatHours(weekSeconds);
  $('#metric-expenses').textContent = formatMoney(weekExpenseCents, state.workspace.currency || 'USD');
}

function renderTodayTimeline(timeEntries, notes, logs, expenses) {
  const [start, end] = todayBounds();
  const items = [];
  timeEntries.filter((row) => row.started_at >= start && row.started_at <= end).forEach((row) => items.push({
    kind: 'session',
    time: row.started_at,
    title: row.title,
    body: `${row.client_name || 'No client'} • ${formatDuration(row.duration_seconds)}`
  }));
  notes.filter((row) => row.occurred_at >= start && row.occurred_at <= end).forEach((row) => items.push({
    kind: 'note',
    time: row.occurred_at,
    title: row.title,
    body: row.body
  }));
  logs.filter((row) => row.occurred_at >= start && row.occurred_at <= end).forEach((row) => items.push({
    kind: row.kind,
    time: row.occurred_at,
    title: row.title,
    body: row.body
  }));
  expenses.filter((row) => row.occurred_at >= start && row.occurred_at <= end).forEach((row) => items.push({
    kind: 'expense',
    time: row.occurred_at,
    title: row.vendor || 'Expense',
    body: formatMoney(row.amount_cents, row.currency || 'USD')
  }));

  items.sort((a, b) => b.time - a.time);
  const holder = $('#today-timeline');
  if (!items.length) {
    holder.className = 'timeline-list empty-state';
    holder.textContent = 'No activity yet today.';
    return;
  }
  holder.className = 'timeline-list';
  holder.innerHTML = items.slice(0, 12).map((item) => `
    <article class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(formatDateTime(item.time))} • ${escapeHtml(item.kind)}</p>
        <p class="body-copy">${escapeHtml(item.body || '')}</p>
      </div>
    </article>
  `).join('');
}

function renderSessions(rows) {
  const filter = state.filterText.sessions.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const hay = `${row.title} ${row.client_name || ''} ${row.project_name || ''} ${row.notes || ''}`.toLowerCase();
    return !filter || hay.includes(filter);
  });
  const holder = $('#session-list');
  if (!filtered.length) {
    holder.className = 'stack-list empty-state';
    holder.textContent = 'No sessions recorded yet.';
    return;
  }
  holder.className = 'stack-list';
  holder.innerHTML = '';
  filtered.forEach((row) => {
    const node = $('#session-item-template').content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="title"]').textContent = row.title;
    node.querySelector('[data-field="meta"]').textContent = `${formatDateTime(row.started_at)} • ${row.client_name || 'No client'} • ${row.project_name || 'No project'} • ${row.task_type || 'No task type'}`;
    node.querySelector('[data-field="duration"]').textContent = formatDuration(row.duration_seconds || 0);
    node.querySelector('[data-field="notes"]').textContent = row.notes || 'No notes attached.';
    node.querySelector('[data-field="hash"]').textContent = row.record_hash || 'Pending hash';
    holder.appendChild(node);
  });
}

function renderNotes(rows) {
  const filter = state.filterText.notes.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const hay = `${row.title} ${row.body || ''}`.toLowerCase();
    return !filter || hay.includes(filter);
  });
  const holder = $('#notes-list');
  if (!filtered.length) {
    holder.className = 'card-list empty-state';
    holder.textContent = 'No notes yet.';
    return;
  }
  holder.className = 'card-list';
  holder.innerHTML = '';
  filtered.forEach((row) => {
    const node = $('#note-item-template').content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="title"]').textContent = row.title;
    node.querySelector('[data-field="meta"]').textContent = `${formatDateTime(row.occurred_at)}${row.linked_time_entry_id ? ` • linked to ${row.linked_time_entry_id}` : ''}`;
    node.querySelector('[data-field="body"]').textContent = row.body || 'No note body.';
    node.querySelector('[data-field="hash"]').textContent = row.record_hash || 'Pending hash';
    holder.appendChild(node);
  });
}

function renderLogs(rows) {
  const holder = $('#logs-list');
  if (!rows.length) {
    holder.className = 'timeline-list empty-state';
    holder.textContent = 'No operator logs yet.';
    return;
  }
  holder.className = 'timeline-list';
  holder.innerHTML = '';
  rows.forEach((row) => {
    const node = $('#log-item-template').content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="title"]').textContent = row.title;
    node.querySelector('[data-field="meta"]').textContent = `${formatDateTime(row.occurred_at)} • ${row.kind}`;
    node.querySelector('[data-field="body"]').textContent = row.body || 'No detail.';
    node.querySelector('[data-field="hash"]').textContent = row.record_hash || 'Pending hash';
    holder.appendChild(node);
  });
}

function renderExpenses(rows) {
  const filter = state.filterText.expenses.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const hay = `${row.vendor || ''} ${row.category || ''} ${row.notes || ''}`.toLowerCase();
    return !filter || hay.includes(filter);
  });
  const holder = $('#expense-list');
  if (!filtered.length) {
    holder.className = 'card-list empty-state';
    holder.textContent = 'No expenses recorded yet.';
    return;
  }
  holder.className = 'card-list';
  holder.innerHTML = '';
  filtered.forEach((row) => {
    const node = $('#expense-item-template').content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="vendor"]').textContent = row.vendor || 'Expense';
    node.querySelector('[data-field="meta"]').textContent = `${formatDateTime(row.occurred_at)} • ${row.category || 'General'}`;
    node.querySelector('[data-field="amount"]').textContent = formatMoney(row.amount_cents || 0, row.currency || 'USD');
    node.querySelector('[data-field="notes"]').textContent = row.notes || 'No notes.';
    node.querySelector('[data-field="receipt"]').textContent = row.receipt_sha256 ? `Receipt SHA-256: ${row.receipt_sha256}` : row.local_receipt_data_url ? 'Receipt pending upload.' : 'No receipt attached.';
    node.querySelector('[data-field="hash"]').textContent = row.record_hash || 'Pending hash';
    holder.appendChild(node);
  });
}

function renderExports(rows) {
  const holder = $('#export-history');
  if (!rows.length) {
    holder.className = 'stack-list empty-state';
    holder.textContent = 'No exports yet.';
    return;
  }
  holder.className = 'stack-list';
  holder.innerHTML = '';
  rows.forEach((row) => {
    const node = $('#export-item-template').content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="title"]').textContent = `PDF export • ${new Date(row.period_start).toLocaleDateString('en-US')} → ${new Date(row.period_end).toLocaleDateString('en-US')}`;
    node.querySelector('[data-field="meta"]').textContent = `${formatDateTime(row.created_at || Date.now())} • ${row.format?.toUpperCase() || 'PDF'}`;
    node.querySelector('[data-field="hash"]').textContent = row.pdf_sha256 || 'Pending hash';
    node.querySelector('[data-field="download"]').addEventListener('click', () => downloadHistoricalExport(row.id));
    holder.appendChild(node);
  });
}

function renderSettings() {
  $('#settings-brand-name').value = state.workspace.brand_name || 'SkyeTime: Hour Logger';
  $('#settings-timezone').value = state.workspace.timezone || 'America/Phoenix';
  $('#settings-currency').value = state.workspace.currency || 'USD';
  getSettings().then((settings) => { $('#settings-token').value = settings.token || ''; });
  $('#export-chain-preview').textContent = state.proofChainHead || 'GENESIS';
}

function updatePendingCount(...collections) {
  const pending = collections.flat().filter((row) => row._dirty).length;
  $('#metric-pending').textContent = String(pending);
}

async function createActivityLog({ kind = 'log', title, body = '', related_entity_type = null, related_entity_id = null, occurred_at = Date.now() }) {
  const record = {
    id: uid('log'),
    kind,
    title,
    body,
    related_entity_type,
    related_entity_id,
    occurred_at,
    created_at: nowIso(),
    updated_at: nowIso(),
    _dirty: true
  };
  record.record_hash = await recordLocalHash('activity_log', record);
  await idbPut('activity_logs', record);
  return record;
}

async function createNote({ title, body, linked_time_entry_id = null, occurred_at = Date.now() }) {
  const record = {
    id: uid('note'),
    title,
    body,
    linked_time_entry_id,
    occurred_at,
    created_at: nowIso(),
    updated_at: nowIso(),
    _dirty: true
  };
  record.record_hash = await recordLocalHash('note', record);
  await idbPut('notes', record);
  return record;
}

async function createTimeEntry(payload) {
  const record = {
    id: uid('tme'),
    title: payload.title || 'Work block',
    client_name: payload.client_name || '',
    project_name: payload.project_name || '',
    task_type: payload.task_type || '',
    started_at: payload.started_at,
    ended_at: payload.ended_at,
    duration_seconds: payload.duration_seconds,
    notes: payload.notes || '',
    status: 'complete',
    device_id: payload.device_id || navigator.userAgent.slice(0, 120),
    created_at: nowIso(),
    updated_at: nowIso(),
    _dirty: true
  };
  record.record_hash = await recordLocalHash('time_entry', record);
  await idbPut('time_entries', record);
  return record;
}

async function createExpense(payload) {
  const record = {
    id: uid('exp'),
    vendor: payload.vendor || '',
    amount_cents: payload.amount_cents || 0,
    currency: state.workspace.currency || 'USD',
    category: payload.category || 'General',
    occurred_at: payload.occurred_at,
    notes: payload.notes || '',
    local_receipt_data_url: payload.local_receipt_data_url || null,
    receipt_object_key: payload.receipt_object_key || null,
    receipt_sha256: payload.receipt_sha256 || null,
    created_at: nowIso(),
    updated_at: nowIso(),
    _dirty: true
  };
  record.record_hash = await recordLocalHash('expense', record);
  await idbPut('expenses', record);
  return record;
}

function activeTimerPayloadFromInputs() {
  return {
    title: $('#session-title').value.trim() || 'Work block',
    client_name: $('#session-client').value.trim(),
    project_name: $('#session-project').value.trim(),
    task_type: $('#session-task-type').value.trim(),
    notes: $('#session-notes').value.trim(),
    started_at: Date.now(),
    id: uid('run')
  };
}

async function startTimer() {
  if (state.timer) return;
  const timer = activeTimerPayloadFromInputs();
  state.timer = timer;
  await saveActiveTimer(timer);
  await createActivityLog({ kind: 'timer-start', title: `Started: ${timer.title}`, body: `${timer.client_name || 'No client'} • ${timer.project_name || 'No project'} • ${timer.task_type || 'No type'}`, occurred_at: timer.started_at });
  renderAll();
  showMessage('Timer running', 'working');
}

async function stopTimer() {
  if (!state.timer) return;
  const endedAt = Date.now();
  const timer = state.timer;
  const duration_seconds = Math.max(1, Math.floor((endedAt - timer.started_at) / 1000));
  const entry = await createTimeEntry({ ...timer, ended_at: endedAt, duration_seconds });
  await createActivityLog({ kind: 'timer-stop', title: `Stopped: ${timer.title}`, body: `Saved ${formatDuration(duration_seconds)} of work.`, related_entity_type: 'time_entry', related_entity_id: entry.id, occurred_at: endedAt });
  state.timer = null;
  await clearActiveTimer();
  renderAll();
  showMessage('Session saved', 'success');
  queueSync();
}

async function saveQuickNote(asLog = false) {
  const title = $('#quick-note-title').value.trim() || (asLog ? 'Operator update' : 'Quick note');
  const body = $('#quick-note-body').value.trim();
  if (!body) {
    showMessage('Write something first.', 'warning');
    return;
  }
  if (asLog) {
    await createActivityLog({ kind: 'manual-log', title, body, occurred_at: Date.now() });
  } else {
    await createNote({ title, body, linked_time_entry_id: null, occurred_at: Date.now() });
  }
  $('#quick-note-title').value = '';
  $('#quick-note-body').value = '';
  renderAll();
  showMessage(asLog ? 'Operator log saved' : 'Note saved', 'success');
  queueSync();
}

async function checkpointNote() {
  if (!state.timer) {
    showMessage('Start a timer before adding a checkpoint.', 'warning');
    return;
  }
  const body = $('#session-notes').value.trim() || 'Checkpoint saved during active work block.';
  await createActivityLog({
    kind: 'checkpoint',
    title: `Checkpoint: ${state.timer.title}`,
    body,
    related_entity_type: 'timer',
    related_entity_id: state.timer.id,
    occurred_at: Date.now()
  });
  renderAll();
  showMessage('Checkpoint logged', 'success');
  queueSync();
}

async function handleReceiptFile(file) {
  if (!file) return;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  state.draftReceipt = { dataUrl, fileName: file.name, size: file.size };
  const holder = $('#receipt-preview');
  holder.className = 'receipt-preview';
  holder.innerHTML = `<img src="${dataUrl}" alt="Receipt preview" />`;
}

function clearExpenseComposer() {
  $('#expense-vendor').value = '';
  $('#expense-amount').value = '';
  $('#expense-category').value = 'General';
  $('#expense-date').value = toLocalDateTimeValue(Date.now());
  $('#expense-notes').value = '';
  $('#expense-receipt').value = '';
  state.draftReceipt = null;
  const holder = $('#receipt-preview');
  holder.className = 'receipt-preview empty-state';
  holder.textContent = 'No receipt selected.';
}

async function saveExpense() {
  const vendor = $('#expense-vendor').value.trim();
  const amount = Number($('#expense-amount').value || 0);
  if (!amount) {
    showMessage('Add an amount before saving.', 'warning');
    return;
  }
  await createExpense({
    vendor,
    amount_cents: Math.round(amount * 100),
    category: $('#expense-category').value,
    occurred_at: new Date($('#expense-date').value || Date.now()).getTime(),
    notes: $('#expense-notes').value.trim(),
    local_receipt_data_url: state.draftReceipt?.dataUrl || null
  });
  clearExpenseComposer();
  renderAll();
  showMessage('Expense saved', 'success');
  queueSync();
}

async function saveManualSession(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const startedAt = new Date(fd.get('started_at')).getTime();
  const endedAt = new Date(fd.get('ended_at')).getTime();
  if (!startedAt || !endedAt || endedAt <= startedAt) {
    showMessage('Manual session times are upside down.', 'warning');
    return;
  }
  const entry = await createTimeEntry({
    title: String(fd.get('title') || '').trim(),
    client_name: String(fd.get('client_name') || '').trim(),
    project_name: String(fd.get('project_name') || '').trim(),
    task_type: String(fd.get('task_type') || '').trim(),
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: Math.floor((endedAt - startedAt) / 1000),
    notes: String(fd.get('notes') || '').trim()
  });
  await createActivityLog({ kind: 'manual-session', title: `Manual session: ${entry.title}`, body: `Saved ${formatDuration(entry.duration_seconds)}.`, related_entity_type: 'time_entry', related_entity_id: entry.id, occurred_at: endedAt });
  $('#manual-session-dialog').close();
  form.reset();
  renderAll();
  showMessage('Manual session saved', 'success');
  queueSync();
}

async function syncReceiptsBeforeBatch(expenses) {
  if (!navigator.onLine || !expenses.length) return expenses;
  const out = [];
  for (const expense of expenses) {
    if (expense.local_receipt_data_url && !expense.receipt_object_key) {
      try {
        const result = await fetchJson('/api/uploads/receipt', {
          method: 'POST',
          body: JSON.stringify({ workspaceId: WORKSPACE_ID, expenseId: expense.id, dataUrl: expense.local_receipt_data_url })
        });
        const merged = {
          ...expense,
          receipt_object_key: result.receipt_object_key,
          receipt_sha256: result.receipt_sha256,
          updated_at: nowIso(),
          _dirty: true
        };
        merged.record_hash = await recordLocalHash('expense', merged);
        await idbPut('expenses', merged);
        out.push(merged);
      } catch (error) {
        console.warn('receipt upload failed', error);
        out.push(expense);
      }
    } else {
      out.push(expense);
    }
  }
  return out;
}

function stripLocal(row) {
  const copy = { ...row };
  delete copy._dirty;
  delete copy.local_receipt_data_url;
  return copy;
}

async function syncNow() {
  if (state.syncInFlight) return;
  state.syncInFlight = true;
  setStatus($('#network-pill'), navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? 'success' : 'warning');
  showMessage('Sync running…', 'working');
  try {
    if (!navigator.onLine) throw new Error('No network. Local mode only.');
    let [time_entries, notes, activity_logs, expenses] = await Promise.all([
      listStore('time_entries'),
      listStore('notes'),
      listStore('activity_logs'),
      listStore('expenses')
    ]);

    const dirtyTime = time_entries.filter((row) => row._dirty);
    const dirtyNotes = notes.filter((row) => row._dirty);
    const dirtyLogs = activity_logs.filter((row) => row._dirty);
    const dirtyExpenses = await syncReceiptsBeforeBatch(expenses.filter((row) => row._dirty));

    if (!dirtyTime.length && !dirtyNotes.length && !dirtyLogs.length && !dirtyExpenses.length) {
      showMessage('Nothing to sync', 'success');
      return;
    }

    const response = await fetchJson('/api/sync/batch', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        time_entries: dirtyTime.map(stripLocal),
        notes: dirtyNotes.map(stripLocal),
        activity_logs: dirtyLogs.map(stripLocal),
        expenses: dirtyExpenses.map(stripLocal)
      })
    });

    const commits = [
      ...(response.synced?.time_entries || []).map((row) => ({ store: 'time_entries', row: { ...row, _dirty: false } })),
      ...(response.synced?.notes || []).map((row) => ({ store: 'notes', row: { ...row, _dirty: false } })),
      ...(response.synced?.activity_logs || []).map((row) => ({ store: 'activity_logs', row: { ...row, _dirty: false } })),
      ...(response.synced?.expenses || []).map((row) => {
        const local = dirtyExpenses.find((item) => item.id === row.id);
        return { store: 'expenses', row: { ...local, ...row, _dirty: false } };
      })
    ];

    for (const item of commits) await idbPut(item.store, item.row);
    state.proofChainHead = response.proof_chain_head || state.proofChainHead;
    $('#chain-pill').textContent = `Proof ${state.proofChainHead.slice(0, 12)}…`;
    showMessage('Sync complete', 'success');
  } catch (error) {
    showMessage(error.message, 'warning');
  } finally {
    state.syncInFlight = false;
    await renderAll();
  }
}

let syncTimer = null;
function queueSync(delay = 900) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCsv() {
  const snapshot = await localSnapshot();
  const rows = [
    ['type', 'title/vendor', 'client', 'project/category', 'started_or_occurred', 'ended', 'duration_seconds', 'amount_cents', 'notes']
  ];
  snapshot.time_entries.forEach((row) => rows.push([
    'time_entry', row.title, row.client_name || '', row.project_name || '', new Date(row.started_at).toISOString(), row.ended_at ? new Date(row.ended_at).toISOString() : '', row.duration_seconds || 0, '', row.notes || ''
  ]));
  snapshot.expenses.forEach((row) => rows.push([
    'expense', row.vendor || '', '', row.category || '', new Date(row.occurred_at).toISOString(), '', '', row.amount_cents || 0, row.notes || ''
  ]));
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `skyetime-export-${toDateInputValue(Date.now())}.csv`);
  showMessage('CSV exported', 'success');
}

async function exportJsonBackup() {
  const snapshot = await localSnapshot();
  const payload = {
    workspace: state.workspace,
    proof_chain_head: state.proofChainHead,
    exported_at: nowIso(),
    ...snapshot
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `skyetime-backup-${toDateInputValue(Date.now())}.json`);
  showMessage('JSON backup exported', 'success');
}

async function exportPdf() {
  if (!navigator.onLine) {
    showMessage('PDF export needs the Worker online.', 'warning');
    return;
  }
  const startDate = $('#export-start').value || toDateInputValue(weekStartMs());
  const endDate = $('#export-end').value || toDateInputValue(Date.now());
  const rangeStart = new Date(`${startDate}T00:00:00`).getTime();
  const rangeEnd = new Date(`${endDate}T23:59:59`).getTime();
  showMessage('Generating branded PDF…', 'working');
  try {
    const settings = await getSettings();
    const headers = new Headers({ 'content-type': 'application/json' });
    if (settings.token) headers.set('x-workspace-token', settings.token);
    const response = await fetch('/api/exports/pdf', {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, rangeStart, rangeEnd })
    });
    if (!response.ok) {
      let errorText = response.statusText;
      try {
        const data = await response.json();
        errorText = data.error || errorText;
      } catch {}
      throw new Error(errorText);
    }
    const manifest = response.headers.get('x-skyetime-manifest-sha256') || 'generated';
    const pdfHash = response.headers.get('x-skyetime-pdf-sha256') || 'pdf';
    state.proofChainHead = response.headers.get('x-skyetime-proof-chain-head') || state.proofChainHead;
    $('#export-manifest-preview').textContent = manifest;
    $('#export-chain-preview').textContent = state.proofChainHead;
    const blob = await response.blob();
    downloadBlob(blob, `skyetime-proof-${startDate}-${pdfHash.slice(0, 8)}.pdf`);
    showMessage('PDF exported', 'success');
    await bootstrapFromServer();
    await renderAll();
  } catch (error) {
    showMessage(error.message, 'warning');
  }
}

async function downloadHistoricalExport(exportId) {
  try {
    const settings = await getSettings();
    const headers = new Headers();
    if (settings.token) headers.set('x-workspace-token', settings.token);
    const response = await fetch(`/api/exports/${exportId}`, { headers });
    if (!response.ok) throw new Error('Could not download export.');
    const hash = response.headers.get('x-skyetime-pdf-sha256') || exportId;
    const blob = await response.blob();
    downloadBlob(blob, `skyetime-proof-${hash.slice(0, 8)}.pdf`);
  } catch (error) {
    showMessage(error.message, 'warning');
  }
}

async function saveWorkspaceSettings() {
  const brand_name = $('#settings-brand-name').value.trim() || 'SkyeTime: Hour Logger';
  const timezone = $('#settings-timezone').value.trim() || 'America/Phoenix';
  const currency = $('#settings-currency').value.trim() || 'USD';
  const token = $('#settings-token').value.trim();
  await saveSettingsLocal({ brand_name, timezone, currency, token });
  state.workspace = { ...state.workspace, brand_name, timezone, currency };
  try {
    if (navigator.onLine) {
      await fetchJson('/api/workspace', {
        method: 'POST',
        body: JSON.stringify({ brand_name, timezone, currency })
      });
      showMessage('Settings saved', 'success');
    } else {
      showMessage('Settings saved locally. Sync later.', 'warning');
    }
  } catch (error) {
    showMessage(`Saved locally: ${error.message}`, 'warning');
  }
  await renderAll();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bindTabs() {
  $$('.nav-chip').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tabTarget;
      $$('.nav-chip').forEach((chip) => chip.classList.toggle('active', chip === button));
      $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === target));
    });
  });
}

function bindEvents() {
  $('#start-timer').addEventListener('click', startTimer);
  $('#stop-timer').addEventListener('click', stopTimer);
  $('#log-checkpoint').addEventListener('click', checkpointNote);
  $('#save-quick-note').addEventListener('click', () => saveQuickNote(false));
  $('#save-quick-log').addEventListener('click', () => saveQuickNote(true));
  $('#expense-receipt').addEventListener('change', (event) => handleReceiptFile(event.target.files?.[0]));
  $('#save-expense').addEventListener('click', saveExpense);
  $('#clear-expense').addEventListener('click', clearExpenseComposer);
  $('#export-pdf').addEventListener('click', exportPdf);
  $('#export-csv').addEventListener('click', exportCsv);
  $('#export-json').addEventListener('click', exportJsonBackup);
  $('#save-settings').addEventListener('click', saveWorkspaceSettings);
  $('#force-sync').addEventListener('click', syncNow);
  $('#open-manual-session').addEventListener('click', () => {
    const dialog = $('#manual-session-dialog');
    const form = $('#manual-session-form');
    form.querySelector('[name="started_at"]').value = toLocalDateTimeValue(Date.now() - 60 * 60 * 1000);
    form.querySelector('[name="ended_at"]').value = toLocalDateTimeValue(Date.now());
    dialog.showModal();
  });
  $('#close-manual-session').addEventListener('click', () => $('#manual-session-dialog').close());
  $('#manual-session-form').addEventListener('submit', saveManualSession);
  $('#session-search').addEventListener('input', (event) => {
    state.filterText.sessions = event.target.value;
    listStore('time_entries').then(renderSessions);
  });
  $('#note-search').addEventListener('input', (event) => {
    state.filterText.notes = event.target.value;
    listStore('notes').then(renderNotes);
  });
  $('#expense-search').addEventListener('input', (event) => {
    state.filterText.expenses = event.target.value;
    listStore('expenses').then(renderExpenses);
  });
  window.addEventListener('online', () => {
    state.isOnline = true;
    setStatus($('#network-pill'), 'Online', 'success');
    queueSync(400);
  });
  window.addEventListener('offline', () => {
    state.isOnline = false;
    setStatus($('#network-pill'), 'Offline', 'warning');
  });
}

function startTimerTicker() {
  setInterval(() => {
    if (state.timer) renderTimer();
  }, 1000);
}

async function hydrateActiveTimer() {
  const timer = await getActiveTimer();
  if (timer) state.timer = timer;
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('service worker registration failed', error);
    }
  }
}

async function prepareApp() {
  if (state.initialized) return;
  state.db = await openDatabase();
  bindTabs();
  bindEvents();
  await hydrateActiveTimer();
  const settings = await getSettings();
  state.workspace = { ...state.workspace, ...settings };
  $('#expense-date').value = toLocalDateTimeValue(Date.now());
  $('#export-start').value = toDateInputValue(weekStartMs());
  $('#export-end').value = toDateInputValue(Date.now());
  setStatus($('#network-pill'), navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? 'success' : 'warning');
  await bootstrapFromServer();
  await renderAll();
  await registerServiceWorker();
  startTimerTicker();
  queueSync(1200);
  state.initialized = true;
}

window.addEventListener('skyetime:intro-finished', prepareApp, { once: true });
if (!document.getElementById('intro-shell')) prepareApp();
