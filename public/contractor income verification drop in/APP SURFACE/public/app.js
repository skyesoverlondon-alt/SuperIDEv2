const BRAND_CONFIG = {
  companyName: 'Skyes Over London Contractor Network',
  logoUrl: '/SkyeDocxPro/assets/icon/brand/icon-192.png',
  contactEmail: 'SkyesOverLondonLC@solenterprises.org',
  contactPhone: '480-469-5416',
  website: 'SOLEnterprises.org',
  ceoName: 'Skyes Over London',
  complianceNote: 'Company-verified operational records. Not government-issued certification.'
};

function getWorkspaceId() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('ws_id') || localStorage.getItem('kx.workspace.id') || 'primary-workspace').trim() || 'primary-workspace';
}

const WORKSPACE_ID = getWorkspaceId();
const DB_NAME = `contractor-verification-mini-suite:${WORKSPACE_ID}`;
const DB_VERSION = 1;
const STORE_KEYS = [
  'profile','incomeRecords','expenseRecords','evidenceItems','invoices','cashflowItems','mileageTrips',
  'credentials','disputes','clients','leads','taxPlans','packetTemplates','verificationLetters','receipts','settings'
];

const MODULES = [
  { id: 'proofPacketStudio', name: 'Proof Packet Studio', kicker: 'App 01', desc: 'Assemble branded proof packets from tracked records and evidence.' },
  { id: 'evidenceVault', name: 'Evidence Vault', kicker: 'App 02', desc: 'Organize screenshots, receipts, contracts, notes, and proof artifacts.' },
  { id: 'incomeStabilityScoreboard', name: 'Income Stability Scoreboard', kicker: 'App 03', desc: 'Visualize stability, trends, volatility, and consistency.' },
  { id: 'credentialWallet', name: 'Credential Wallet', kicker: 'App 04', desc: 'Store membership, credentials, verification levels, and status.' },
  { id: 'disputeDefenseBuilder', name: 'Dispute Defense Builder', kicker: 'App 05', desc: 'Build dispute timelines and supporting evidence packs.' },
  { id: 'taxBucketPlanner', name: 'Tax Bucket Planner', kicker: 'App 06', desc: 'Sort earnings and expenses into tax buckets with reserve planning.' },
  { id: 'clientDependenceRadar', name: 'Client Dependence Radar', kicker: 'App 07', desc: 'See overexposure to one client and diversification risk.' },
  { id: 'mileageFieldLedger', name: 'Mileage + Field Activity Ledger', kicker: 'App 08', desc: 'Track trips, mileage, and field activity details.' },
  { id: 'invoiceConfidenceDesk', name: 'Invoice Confidence Desk', kicker: 'App 09', desc: 'Track invoices, aging, and expected cash timing.' },
  { id: 'cashflowCalendar', name: 'Cashflow Calendar', kicker: 'App 10', desc: 'Map inflows, outflows, and danger weeks on a monthly calendar.' },
  { id: 'receiptRescue', name: 'Receipt Rescue', kicker: 'App 11', desc: 'Quick-entry receipt triage and categorization queue.' },
  { id: 'verificationLetterComposer', name: 'Verification Letter Composer', kicker: 'App 12', desc: 'Generate branded verification letters with selectable facts.' },
  { id: 'contractorOperatingProfile', name: 'Contractor Operating Profile', kicker: 'App 13', desc: 'Present a clean operating dossier for the contractor.' },
  { id: 'leadToContractBoard', name: 'Lead-to-Contract Conversion Board', kicker: 'App 14', desc: 'Track lead conversion from intro to signed operator/member.' },
  { id: 'missingProofDetector', name: 'Missing Proof Detector', kicker: 'App 15', desc: 'Find proof gaps between claims and attached evidence.' }
];

let db;
let state = {};
let activeModule = 'dashboardView';
let workspaceSync = null;
let applyingSyncedState = false;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const monthKey = (d) => (d || '').slice(0, 7);
const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function cloneStatePayload(source) {
  const payload = {};
  STORE_KEYS.forEach((key) => {
    payload[key] = Array.isArray(source && source[key])
      ? source[key].map((item) => ({ ...item }))
      : [];
  });
  return payload;
}

async function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function rawPut(storeName, obj) {
  return new Promise((resolve, reject) => {
    const payload = { id: obj.id || uid(), ...obj, updatedAt: obj.updatedAt || new Date().toISOString() };
    const req = tx(storeName, 'readwrite').put(payload);
    req.onsuccess = () => resolve(payload);
    req.onerror = () => reject(req.error);
  });
}

async function persistStatePayload(payload) {
  for (const key of STORE_KEYS) {
    await clearStore(key);
    for (const item of payload[key] || []) {
      await rawPut(key, item);
    }
  }
}

function scheduleWorkspaceSync() {
  if (applyingSyncedState || !workspaceSync) return;
  workspaceSync.debouncedSave();
}

async function applySyncedState(payload) {
  applyingSyncedState = true;
  try {
    await persistStatePayload(cloneStatePayload(payload || {}));
    await loadState({ skipSync: true });
    refreshAll();
    openModule(activeModule);
  } finally {
    applyingSyncedState = false;
  }
}

function renderWorkspaceChrome() {
  const badge = $('#workspaceIdBadge');
  if (badge) badge.textContent = WORKSPACE_ID;
  $$('.carry').forEach((node) => {
    const href = node.getAttribute('href');
    if (!href) return;
    const url = new URL(href, window.location.origin);
    url.searchParams.set('ws_id', WORKSPACE_ID);
    node.setAttribute('href', `${url.pathname}${url.search}`);
  });
}

async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORE_KEYS.forEach(key => {
        if (!database.objectStoreNames.contains(key)) {
          database.createObjectStore(key, { keyPath: 'id' });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}
async function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function put(storeName, obj) {
  return new Promise((resolve, reject) => {
    const payload = { id: obj.id || uid(), ...obj, updatedAt: new Date().toISOString() };
    const req = tx(storeName, 'readwrite').put(payload);
    req.onsuccess = () => resolve(payload);
    req.onerror = () => reject(req.error);
  });
}
async function remove(storeName, id) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function loadState(options = {}) {
  for (const key of STORE_KEYS) state[key] = await getAll(key);
  if (!state.profile.length) {
    await put('profile', { id: 'primary-profile', legalName: 'Skyes Over London Contractor', businessName: 'Skyes Over London', serviceTypes: 'Independent contractor services', regions: 'Arizona', verificationLevel: 'Network Verified', activeStatus: 'Active' });
    state.profile = await getAll('profile');
  }
  if (!state.settings.length) {
    await put('settings', { id: 'brand-settings', ...BRAND_CONFIG });
    state.settings = await getAll('settings');
  }
  if (!options.skipSync) scheduleWorkspaceSync();
}

function getProfile() { return state.profile[0] || {}; }
function getSettings() { return state.settings[0] || BRAND_CONFIG; }
function totals() {
  const income = state.incomeRecords.reduce((a, b) => a + Number(b.amount || 0), 0);
  const expense = state.expenseRecords.reduce((a, b) => a + Number(b.amount || 0), 0);
  return { income, expense, evidence: state.evidenceItems.length, gaps: computeProofGaps().length };
}

function renderNav() {
  const nav = $('#moduleNav');
  nav.innerHTML = `<button class="cvs-nav-btn ${activeModule==='dashboardView'?'active':''}" data-module="dashboardView">Dashboard</button>` + MODULES.map(m => `<button class="cvs-nav-btn ${activeModule===m.id?'active':''}" data-module="${m.id}"><div class="cvs-kicker">${m.kicker}</div><div>${m.name}</div></button>`).join('');
  $$('.cvs-nav-btn', nav).forEach(btn => btn.onclick = () => openModule(btn.dataset.module));
}

function renderDashboard() {
  const grid = $('#dashboardGrid');
  grid.innerHTML = MODULES.map(m => `<article class="cvs-module-card" data-open-module="${m.id}"><div class="cvs-kicker">${m.kicker}</div><h3>${m.name}</h3><p>${m.desc}</p></article>`).join('');
  $$('[data-open-module]', grid).forEach(el => el.onclick = () => openModule(el.dataset.openModule));
  $$('[data-open-module]').filter(el => el.closest('.cvs-quick-actions')).forEach(el => el.onclick = () => openModule(el.dataset.openModule));
  const t = totals();
  $('#heroIncome').textContent = money(t.income);
  $('#heroExpense').textContent = money(t.expense);
  $('#heroEvidence').textContent = t.evidence;
  $('#heroGaps').textContent = t.gaps;
}

function openModule(moduleId) {
  activeModule = moduleId;
  renderNav();
  $('#dashboardView').classList.toggle('active', moduleId === 'dashboardView');
  const container = $('#moduleContainer');
  $$('#moduleContainer > section').forEach(sec => sec.classList.remove('active'));
  if (moduleId === 'dashboardView') return;
  let section = document.getElementById(moduleId);
  if (!section) {
    section = document.createElement('section');
    section.id = moduleId;
    container.appendChild(section);
  }
  section.className = 'active';
  moduleRenderers[moduleId](section);
}

function renderTable(rows, cols) {
  if (!rows.length) return `<div class="cvs-empty">No items saved yet.</div>`;
  return `<div class="cvs-table-wrap"><table class="cvs-table"><thead><tr>${cols.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c.render ? c.render(r) : safe(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function listCard(item, meta = [], body = '') {
  return `<article class="cvs-list-item"><h4>${safe(item.title || item.name || item.client || item.subject || 'Untitled')}</h4><div class="cvs-meta">${meta.map(m => `<span class="cvs-tag">${safe(m)}</span>`).join('')}</div>${body ? `<div class="cvs-note" style="margin-top:10px">${body}</div>` : ''}</article>`;
}

function computeMonthlyIncome() {
  const map = {};
  state.incomeRecords.forEach(r => { const k = monthKey(r.date); if (k) map[k] = (map[k] || 0) + Number(r.amount || 0); });
  return Object.entries(map).sort(([a],[b]) => a.localeCompare(b));
}
function computeProofGaps() {
  const evByMonth = {};
  state.evidenceItems.forEach(e => { const k = monthKey(e.date); evByMonth[k] = (evByMonth[k] || 0) + 1; });
  return state.incomeRecords.filter(r => !evByMonth[monthKey(r.date)]).map(r => ({...r, reason: 'No evidence item exists for this income month.'}));
}
function exportCSV(filename, rows) {
  if (!rows.length) return alert('No rows to export.');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function exportJSONBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `contractor-verification-suite-${WORKSPACE_ID}.json`; a.click(); URL.revokeObjectURL(a.href);
}
async function importJSONBackup(file) {
  const parsed = JSON.parse(await file.text());
  for (const key of STORE_KEYS) {
    if (Array.isArray(parsed[key])) for (const item of parsed[key]) await put(key, item);
  }
  await loadState();
  refreshAll();
}
function printSection(el) {
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Print View</title><style>body{font-family:Inter,Arial,sans-serif;padding:32px;color:#111} .print-card{max-width:980px;margin:0 auto} h1,h2,h3{margin-top:0} .row{display:flex;gap:12px;flex-wrap:wrap}.pill{display:inline-block;border:1px solid #ccc;border-radius:999px;padding:4px 8px;margin:2px;font-size:12px}.muted{color:#666} table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:10px;text-align:left} .section{margin-top:24px}</style></head><body><div class="print-card">${el.innerHTML}</div></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

const moduleRenderers = {
  proofPacketStudio(section) {
    const settings = getSettings(), profile = getProfile();
    const totalIncome = state.incomeRecords.reduce((a,b)=>a+Number(b.amount||0),0);
    const totalExpense = state.expenseRecords.reduce((a,b)=>a+Number(b.amount||0),0);
    const net = totalIncome - totalExpense;
    section.innerHTML = `
      <div class="cvs-panel">
        <div class="cvs-panel-head"><div><div class="cvs-kicker">App 01</div><h2>Proof Packet Studio</h2></div><div class="cvs-inline-actions"><button id="packetSaveBtn" class="cvs-btn cvs-btn-ghost">Save template</button><button id="packetPrintBtn" class="cvs-btn">Print packet</button></div></div>
        <div class="cvs-two-col">
          <div class="cvs-form">
            <label>Packet title<input id="packetTitle" value="Contractor Income Proof Packet" /></label>
            <label>Reporting period<input id="packetPeriod" value="${new Date().getFullYear()} YTD" /></label>
            <label>Cover note<textarea id="packetNote">This packet summarizes tracked operational records, evidence, and internal verification context maintained inside the platform.</textarea></label>
            <div class="cvs-note">Use browser print to save this packet as PDF. Replace wording to match your compliance stack later.</div>
          </div>
          <div id="packetPreview" class="cvs-print-frame">
            <h1>${safe(settings.companyName)} — Contractor Proof Packet</h1>
            <p><strong>Subject:</strong> ${safe(profile.legalName || profile.businessName || 'Contractor')}</p>
            <p><strong>Reporting window:</strong> <span id="packetPeriodOut">${new Date().getFullYear()} YTD</span></p>
            <p><strong>Verification posture:</strong> ${safe(settings.complianceNote)}</p>
            <div class="section"><h2>Income Summary</h2><table><tr><th>Total income</th><td>${money(totalIncome)}</td></tr><tr><th>Total expenses</th><td>${money(totalExpense)}</td></tr><tr><th>Net operational total</th><td>${money(net)}</td></tr><tr><th>Evidence items</th><td>${state.evidenceItems.length}</td></tr></table></div>
            <div class="section"><h2>Top Income Records</h2>${renderTable(state.incomeRecords.slice(0,8), [{label:'Date',key:'date'},{label:'Client',key:'client'},{label:'Amount',render:r=>money(r.amount)},{label:'Source',key:'source'}])}</div>
            <div class="section"><h2>Supporting Note</h2><p id="packetNoteOut">This packet summarizes tracked operational records, evidence, and internal verification context maintained inside the platform.</p></div>
            <div class="section"><h2>Company Contact</h2><p>${safe(settings.companyName)}<br>${safe(settings.contactEmail)}<br>${safe(settings.contactPhone)}<br>${safe(settings.website)}</p></div>
          </div>
        </div>
      </div>`;
    $('#packetTitle', section).oninput = e => section.querySelector('#packetPreview h1').textContent = `${settings.companyName} — ${e.target.value}`;
    $('#packetPeriod', section).oninput = e => $('#packetPeriodOut', section).textContent = e.target.value;
    $('#packetNote', section).oninput = e => $('#packetNoteOut', section).textContent = e.target.value;
    $('#packetPrintBtn', section).onclick = () => printSection($('#packetPreview', section));
    $('#packetSaveBtn', section).onclick = async () => { await put('packetTemplates', { title: $('#packetTitle', section).value, period: $('#packetPeriod', section).value, note: $('#packetNote', section).value }); await loadState(); alert('Packet template saved.'); };
  },
  evidenceVault(section) {
    section.innerHTML = `
      <div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 02</div><h2>Evidence Vault</h2></div><button id="evidenceExportCsv" class="cvs-btn cvs-btn-ghost">Export CSV</button></div>
      <div class="cvs-two-col"><form id="evidenceForm" class="cvs-form">
        <label>Title<input name="title" required /></label>
        <div class="cvs-form-grid"><label>Date<input name="date" type="date" required /></label><label>Type<select name="type"><option>Receipt</option><option>Invoice</option><option>Contract</option><option>Screenshot</option><option>Work Log</option></select></label></div>
        <div class="cvs-form-grid"><label>Client / Job<input name="client" /></label><label>Reference URL / note<input name="ref" /></label></div>
        <label>Summary<textarea name="summary"></textarea></label>
        <button class="cvs-btn" type="submit">Save evidence</button>
      </form><div><div id="evidenceList" class="cvs-list"></div></div></div></div>`;
    const render = () => $('#evidenceList', section).innerHTML = state.evidenceItems.length ? state.evidenceItems.map(item => `${listCard(item,[item.type,item.date,item.client||'No client'], safe(item.summary||''))}<div class="cvs-inline-actions"><button class="cvs-btn cvs-btn-ghost" data-del="${item.id}">Delete</button></div>`).join('') : `<div class="cvs-empty">No evidence yet.</div>`;
    render();
    $('#evidenceForm', section).onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); await put('evidenceItems', Object.fromEntries(f.entries())); await loadState(); render(); renderDashboard(); e.target.reset(); };
    section.onclick = async (e) => { if (e.target.dataset.del) { await remove('evidenceItems', e.target.dataset.del); await loadState(); render(); renderDashboard(); } };
    $('#evidenceExportCsv', section).onclick = () => exportCSV('evidence-vault.csv', state.evidenceItems);
  },
  incomeStabilityScoreboard(section) {
    const monthly = computeMonthlyIncome();
    const vals = monthly.map(([,v])=>v); const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    const max = Math.max(...vals,1), min = vals.length ? Math.min(...vals) : 0;
    const volatility = avg ? (((max-min)/avg)*100) : 0;
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 03</div><h2>Income Stability Scoreboard</h2></div></div>
      <div class="cvs-grid-4"><div class="cvs-stat-card"><span>Average month</span><strong>${money(avg)}</strong></div><div class="cvs-stat-card"><span>Best month</span><strong>${money(max)}</strong></div><div class="cvs-stat-card"><span>Lowest month</span><strong>${money(min)}</strong></div><div class="cvs-stat-card"><span>Volatility</span><strong>${volatility.toFixed(1)}%</strong></div></div>
      <div class="cvs-panel" style="margin-top:18px"><div class="cvs-panel-head"><h3>Monthly income trend</h3></div><div class="cvs-chart-bars">${monthly.length ? monthly.map(([k,v])=>`<div class="cvs-bar-row"><span>${k}</span><div class="cvs-bar-track"><div class="cvs-bar-fill" style="width:${(v/max)*100}%"></div></div><strong>${money(v)}</strong></div>`).join('') : '<div class="cvs-empty">Add income records to generate trend bars.</div>'}</div></div>
    </div>`;
  },
  credentialWallet(section) {
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 04</div><h2>Credential Wallet</h2></div></div><div class="cvs-two-col"><form id="credForm" class="cvs-form"><label>Credential name<input name="name" required /></label><div class="cvs-form-grid"><label>Status<select name="status"><option>Active</option><option>Pending</option><option>Expired</option></select></label><label>Level<select name="level"><option>Network Verified</option><option>Compliance Reviewed</option><option>Enhanced Review</option></select></label></div><div class="cvs-form-grid"><label>Issued date<input name="issuedDate" type="date" /></label><label>Expiry date<input name="expiryDate" type="date" /></label></div><label>Notes<textarea name="notes"></textarea></label><button class="cvs-btn">Save credential</button></form><div id="credList" class="cvs-list"></div></div></div>`;
    const render = () => $('#credList', section).innerHTML = state.credentials.length ? state.credentials.map(c => `${listCard(c,[c.status,c.level,c.issuedDate||'No date'], safe(c.notes||''))}<div class="cvs-inline-actions"><button class="cvs-btn cvs-btn-ghost" data-del="${c.id}">Delete</button></div>`).join('') : '<div class="cvs-empty">No credentials yet.</div>';
    render(); $('#credForm', section).onsubmit = async e => { e.preventDefault(); await put('credentials', Object.fromEntries(new FormData(e.target).entries())); await loadState(); render(); e.target.reset(); };
    section.onclick = async e => { if (e.target.dataset.del) { await remove('credentials', e.target.dataset.del); await loadState(); render(); } };
  },
  disputeDefenseBuilder(section) {
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 05</div><h2>Dispute Defense Builder</h2></div></div><div class="cvs-two-col"><form id="disputeForm" class="cvs-form"><label>Dispute title<input name="title" required /></label><div class="cvs-form-grid"><label>Counterparty<input name="counterparty" /></label><label>Incident date<input name="incidentDate" type="date" /></label></div><label>Claim / issue<textarea name="issue"></textarea></label><label>Chronology<textarea name="timeline"></textarea></label><button class="cvs-btn">Save dispute pack</button></form><div id="disputeList" class="cvs-list"></div></div></div>`;
    const render = () => $('#disputeList', section).innerHTML = state.disputes.length ? state.disputes.map(d => listCard(d,[d.counterparty||'No counterparty',d.incidentDate||'No date'], `<strong>Issue:</strong> ${safe(d.issue||'')}<br><strong>Timeline:</strong> ${safe(d.timeline||'')}`)).join('') : '<div class="cvs-empty">No dispute packs yet.</div>';
    render(); $('#disputeForm', section).onsubmit = async e => { e.preventDefault(); await put('disputes', Object.fromEntries(new FormData(e.target).entries())); await loadState(); render(); e.target.reset(); };
  },
  taxBucketPlanner(section) {
    const income = state.incomeRecords.reduce((a,b)=>a+Number(b.amount||0),0); const expense = state.expenseRecords.reduce((a,b)=>a+Number(b.amount||0),0); const net = income-expense; const reserve = net*0.22;
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 06</div><h2>Tax Bucket Planner</h2></div></div><div class="cvs-grid-4"><div class="cvs-stat-card"><span>Gross tracked income</span><strong>${money(income)}</strong></div><div class="cvs-stat-card"><span>Tracked expenses</span><strong>${money(expense)}</strong></div><div class="cvs-stat-card"><span>Net operational amount</span><strong>${money(net)}</strong></div><div class="cvs-stat-card"><span>22% reserve target</span><strong>${money(reserve)}</strong></div></div><div class="cvs-panel" style="margin-top:18px"><div class="cvs-panel-head"><h3>Planner note</h3></div><p class="cvs-note">This planner is a front-end reserve tool, not tax advice. Replace reserve logic and categories later if you wire a formal tax lane.</p></div></div>`;
  },
  clientDependenceRadar(section) {
    const byClient = {};
    state.incomeRecords.forEach(r => { const k = r.client || 'Unassigned'; byClient[k] = (byClient[k]||0)+Number(r.amount||0); });
    const entries = Object.entries(byClient).sort((a,b)=>b[1]-a[1]); const total = entries.reduce((a,[,v])=>a+v,0) || 1;
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 07</div><h2>Client Dependence Radar</h2></div></div><div class="cvs-chart-bars">${entries.length ? entries.map(([k,v])=>`<div class="cvs-bar-row"><span>${safe(k)}</span><div class="cvs-bar-track"><div class="cvs-bar-fill" style="width:${(v/total)*100}%"></div></div><strong>${((v/total)*100).toFixed(1)}%</strong></div>`).join('') : '<div class="cvs-empty">Add income records with clients to see concentration risk.</div>'}</div></div>`;
  },
  mileageFieldLedger(section) {
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 08</div><h2>Mileage + Field Activity Ledger</h2></div><button id="mileageCsvBtn" class="cvs-btn cvs-btn-ghost">Export CSV</button></div><div class="cvs-two-col"><form id="tripForm" class="cvs-form"><div class="cvs-form-grid"><label>Date<input name="date" type="date" required /></label><label>Miles<input name="miles" type="number" step="0.1" required /></label></div><div class="cvs-form-grid"><label>Client / job<input name="client" /></label><label>Purpose<input name="purpose" /></label></div><label>Notes<textarea name="notes"></textarea></label><button class="cvs-btn">Save trip</button></form><div id="tripList"></div></div></div>`;
    const render = () => { const miles = state.mileageTrips.reduce((a,b)=>a+Number(b.miles||0),0); $('#tripList', section).innerHTML = `<div class="cvs-note">Total tracked miles: <strong>${miles.toFixed(1)}</strong></div>` + (state.mileageTrips.length ? renderTable(state.mileageTrips,[{label:'Date',key:'date'},{label:'Miles',key:'miles'},{label:'Client',key:'client'},{label:'Purpose',key:'purpose'}]) : '<div class="cvs-empty">No trips logged.</div>'); };
    render(); $('#tripForm', section).onsubmit = async e => { e.preventDefault(); await put('mileageTrips', Object.fromEntries(new FormData(e.target).entries())); await loadState(); render(); e.target.reset(); };
    $('#mileageCsvBtn', section).onclick = () => exportCSV('mileage-ledger.csv', state.mileageTrips);
  },
  invoiceConfidenceDesk(section) {
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 09</div><h2>Invoice Confidence Desk</h2></div></div><div class="cvs-two-col"><form id="invoiceForm" class="cvs-form"><label>Invoice title<input name="title" required /></label><div class="cvs-form-grid"><label>Client<input name="client" /></label><label>Amount<input name="amount" type="number" step="0.01" required /></label></div><div class="cvs-form-grid"><label>Issue date<input name="issueDate" type="date" /></label><label>Due date<input name="dueDate" type="date" /></label></div><label>Status<select name="status"><option>Draft</option><option>Sent</option><option>Partial</option><option>Paid</option><option>Late</option></select></label><button class="cvs-btn">Save invoice</button></form><div id="invoiceList"></div></div></div>`;
    const render = () => $('#invoiceList', section).innerHTML = state.invoices.length ? renderTable(state.invoices,[{label:'Title',key:'title'},{label:'Client',key:'client'},{label:'Amount',render:r=>money(r.amount)},{label:'Due',key:'dueDate'},{label:'Status',key:'status'}]) : '<div class="cvs-empty">No invoices yet.</div>';
    render(); $('#invoiceForm', section).onsubmit = async e => { e.preventDefault(); await put('invoices', Object.fromEntries(new FormData(e.target).entries())); await loadState(); render(); e.target.reset(); };
  },
  cashflowCalendar(section) {
    const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
    const daysInMonth = new Date(year, month+1, 0).getDate(); const list = Array.from({length: daysInMonth}, (_,i)=>`${year}-${String(month+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);
    const items = [...state.incomeRecords.map(r=>({...r, kind:'income'})), ...state.expenseRecords.map(r=>({...r, kind:'expense'})), ...state.invoices.map(r=>({date:r.dueDate, amount:r.amount, title:r.title, kind:'invoice'}))];
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 10</div><h2>Cashflow Calendar</h2></div></div><div class="cvs-calendar">${list.map(day=>{ const dayItems = items.filter(i=>i.date===day); const totalIn = dayItems.filter(i=>i.kind==='income'||i.kind==='invoice').reduce((a,b)=>a+Number(b.amount||0),0); const totalOut = dayItems.filter(i=>i.kind==='expense').reduce((a,b)=>a+Number(b.amount||0),0); return `<div class="cvs-cal-day"><strong>${day.slice(-2)}</strong><div class="cvs-small cvs-green">In: ${money(totalIn)}</div><div class="cvs-small cvs-danger">Out: ${money(totalOut)}</div>${dayItems.slice(0,3).map(i=>`<div class="cvs-small">${safe(i.title||i.client||i.kind)}</div>`).join('')}</div>`;}).join('')}</div></div>`;
  },
  receiptRescue(section) {
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 11</div><h2>Receipt Rescue</h2></div></div><div class="cvs-two-col"><form id="receiptForm" class="cvs-form"><label>Merchant / receipt title<input name="title" required /></label><div class="cvs-form-grid"><label>Date<input name="date" type="date" required /></label><label>Amount<input name="amount" type="number" step="0.01" required /></label></div><div class="cvs-form-grid"><label>Category<input name="category" /></label><label>Job / client<input name="client" /></label></div><label>Notes<textarea name="notes"></textarea></label><button class="cvs-btn">Queue receipt</button></form><div id="receiptList" class="cvs-list"></div></div></div>`;
    const render = () => $('#receiptList', section).innerHTML = state.receipts.length ? state.receipts.map(r => listCard(r,[r.date,money(r.amount),r.category||'Uncategorized'], safe(r.notes||''))).join('') : '<div class="cvs-empty">No receipts queued.</div>';
    render(); $('#receiptForm', section).onsubmit = async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target).entries()); await put('receipts', data); await put('expenseRecords', { title:data.title, date:data.date, amount:data.amount, category:data.category, client:data.client, source:'Receipt Rescue' }); await loadState(); render(); renderDashboard(); e.target.reset(); };
  },
  verificationLetterComposer(section) {
    const settings = getSettings(), profile = getProfile();
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 12</div><h2>Verification Letter Composer</h2></div><div class="cvs-inline-actions"><button id="letterSaveBtn" class="cvs-btn cvs-btn-ghost">Save letter</button><button id="letterPrintBtn" class="cvs-btn">Print letter</button></div></div><div class="cvs-two-col"><form class="cvs-form"><label>Recipient<input id="letterRecipient" value="To Whom It May Concern" /></label><label>Subject<input id="letterSubject" value="Contractor Record Verification" /></label><label>Body<textarea id="letterBody">${profile.legalName || 'This contractor'} maintains records inside ${settings.companyName}'s governed contractor platform. Based on the tracked records currently present, this letter confirms active participation and documented operational activity within the reporting environment.</textarea></label></form><div id="letterPreview" class="cvs-print-frame"><h1>${safe(settings.companyName)}</h1><p>${safe(settings.contactEmail)} · ${safe(settings.contactPhone)} · ${safe(settings.website)}</p><hr><p id="letterRecipientOut">To Whom It May Concern</p><h2 id="letterSubjectOut">Contractor Record Verification</h2><p id="letterBodyOut">${safe(profile.legalName || 'This contractor')} maintains records inside ${safe(settings.companyName)}'s governed contractor platform. Based on the tracked records currently present, this letter confirms active participation and documented operational activity within the reporting environment.</p><p>${safe(settings.complianceNote)}</p><p>Sincerely,<br>${safe(settings.ceoName)}<br>${safe(settings.companyName)}</p></div></div></div>`;
    ['Recipient','Subject','Body'].forEach(key => $(`#letter${key}`, section).oninput = e => $(`#letter${key}Out`, section).textContent = e.target.value);
    $('#letterPrintBtn', section).onclick = () => printSection($('#letterPreview', section));
    $('#letterSaveBtn', section).onclick = async () => { await put('verificationLetters', { recipient: $('#letterRecipient', section).value, subject: $('#letterSubject', section).value, body: $('#letterBody', section).value }); await loadState(); alert('Letter saved.'); };
  },
  contractorOperatingProfile(section) {
    const p = getProfile();
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 13</div><h2>Contractor Operating Profile</h2></div></div><div class="cvs-two-col"><form id="profileForm" class="cvs-form"><label>Legal name<input name="legalName" value="${safe(p.legalName||'')}" /></label><label>Business name<input name="businessName" value="${safe(p.businessName||'')}" /></label><div class="cvs-form-grid"><label>Service types<input name="serviceTypes" value="${safe(p.serviceTypes||'')}" /></label><label>Operating regions<input name="regions" value="${safe(p.regions||'')}" /></label></div><div class="cvs-form-grid"><label>Verification level<input name="verificationLevel" value="${safe(p.verificationLevel||'')}" /></label><label>Active status<input name="activeStatus" value="${safe(p.activeStatus||'')}" /></label></div><label>About / operating note<textarea name="summary">${safe(p.summary||'')}</textarea></label><button class="cvs-btn">Save profile</button></form><div class="cvs-print-frame"><h1>${safe(p.legalName||'Contractor')}</h1><p><strong>Business:</strong> ${safe(p.businessName||'')}</p><p><strong>Services:</strong> ${safe(p.serviceTypes||'')}</p><p><strong>Regions:</strong> ${safe(p.regions||'')}</p><p><strong>Verification level:</strong> ${safe(p.verificationLevel||'')}</p><p><strong>Status:</strong> ${safe(p.activeStatus||'')}</p><p>${safe(p.summary||'')}</p></div></div></div>`;
    $('#profileForm', section).onsubmit = async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target).entries()); await put('profile', { id:'primary-profile', ...data }); await loadState(); moduleRenderers.contractorOperatingProfile(section); };
  },
  leadToContractBoard(section) {
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 14</div><h2>Lead-to-Contract Conversion Board</h2></div></div><div class="cvs-two-col"><form id="leadForm" class="cvs-form"><label>Lead / candidate name<input name="title" required /></label><div class="cvs-form-grid"><label>Contact<input name="contact" /></label><label>Stage<select name="stage"><option>Lead</option><option>Qualified</option><option>Document Review</option><option>Approved</option><option>Signed</option></select></label></div><label>Notes<textarea name="notes"></textarea></label><button class="cvs-btn">Save pipeline item</button></form><div id="leadBoard" class="cvs-grid-4"></div></div></div>`;
    const stages = ['Lead','Qualified','Document Review','Approved','Signed'];
    const render = () => $('#leadBoard', section).innerHTML = stages.map(stage => `<div class="cvs-panel"><div class="cvs-panel-head"><h3>${stage}</h3></div>${state.leads.filter(l=>l.stage===stage).map(l=>`<div class="cvs-list-item"><strong>${safe(l.title)}</strong><div class="cvs-small">${safe(l.contact||'')}</div><div class="cvs-small">${safe(l.notes||'')}</div></div>`).join('') || '<div class="cvs-empty">Empty</div>'}</div>`).join('');
    render(); $('#leadForm', section).onsubmit = async e => { e.preventDefault(); await put('leads', Object.fromEntries(new FormData(e.target).entries())); await loadState(); render(); e.target.reset(); };
  },
  missingProofDetector(section) {
    const gaps = computeProofGaps();
    section.innerHTML = `<div class="cvs-panel"><div class="cvs-panel-head"><div><div class="cvs-kicker">App 15</div><h2>Missing Proof Detector</h2></div></div><div class="cvs-note">This scanner compares income entries against month-level evidence presence. Tighten the logic later if you want receipt-level or invoice-level matching.</div><div style="margin-top:16px">${gaps.length ? renderTable(gaps,[{label:'Date',key:'date'},{label:'Client',key:'client'},{label:'Amount',render:r=>money(r.amount)},{label:'Reason',key:'reason'}]) : '<div class="cvs-empty">No proof gaps detected by the current rules.</div>'}</div></div>`;
  }
};

function seedIfEmptyActions() {
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.id === 'incomeQuickForm') {
      e.preventDefault();
      await put('incomeRecords', Object.fromEntries(new FormData(form).entries())); await loadState(); refreshAll(); form.reset();
    }
    if (form.id === 'expenseQuickForm') {
      e.preventDefault();
      await put('expenseRecords', Object.fromEntries(new FormData(form).entries())); await loadState(); refreshAll(); form.reset();
    }
  });
}

function addQuickDataPanels() {
  const view = $('#dashboardView');
  const panel = document.createElement('div');
  panel.className = 'cvs-two-col';
  panel.innerHTML = `
    <div class="cvs-panel"><div class="cvs-panel-head"><h3>Quick income entry</h3></div><form id="incomeQuickForm" class="cvs-form"><div class="cvs-form-grid"><label>Date<input name="date" type="date" required></label><label>Amount<input name="amount" type="number" step="0.01" required></label></div><div class="cvs-form-grid"><label>Client<input name="client"></label><label>Source<input name="source" value="Manual"></label></div><button class="cvs-btn">Add income</button></form></div>
    <div class="cvs-panel"><div class="cvs-panel-head"><h3>Quick expense entry</h3></div><form id="expenseQuickForm" class="cvs-form"><div class="cvs-form-grid"><label>Date<input name="date" type="date" required></label><label>Amount<input name="amount" type="number" step="0.01" required></label></div><div class="cvs-form-grid"><label>Category<input name="category"></label><label>Client<input name="client"></label></div><button class="cvs-btn">Add expense</button></form></div>`;
  view.appendChild(panel);
}

function refreshAll() {
  renderDashboard();
  if (activeModule !== 'dashboardView' && moduleRenderers[activeModule]) moduleRenderers[activeModule](document.getElementById(activeModule));
}

async function init() {
  db = await openDB();
  await loadState({ skipSync: true });
  renderWorkspaceChrome();
  if (window.SkyeAppStorageProtocol && typeof window.SkyeAppStorageProtocol.create === 'function') {
    workspaceSync = window.SkyeAppStorageProtocol.create({
      appId: 'ContractorVerificationSuite',
      recordApp: 'ContractorVerificationSuite',
      wsId: WORKSPACE_ID,
      statusElementId: 'syncStatus',
      vaultStatusElementId: 'vaultStatus',
      pushVaultButtonId: 'pushVaultBtn',
      openVaultButtonId: 'openVaultBtn',
      targetAliases: ['ContractorVerificationSuite'],
      getState: () => cloneStatePayload(state),
      serialize: (payload) => cloneStatePayload(payload || {}),
      deserialize: (payload) => cloneStatePayload(payload || {}),
      applyState: (payload) => {
        applySyncedState(payload).catch((error) => console.error('Failed to apply synced contractor verification state', error));
      },
      buildVaultPayload: (payload) => cloneStatePayload(payload || {}),
      getTitle: () => {
        const profile = getProfile();
        return profile.legalName || profile.businessName || `Contractor Verification Suite ${WORKSPACE_ID}`;
      },
    });
  } else if (window.SkyeWorkspaceRecordSync && typeof window.SkyeWorkspaceRecordSync.create === 'function') {
    workspaceSync = window.SkyeWorkspaceRecordSync.create({
      appId: 'ContractorVerificationSuite',
      recordApp: 'ContractorVerificationSuite',
      wsId: WORKSPACE_ID,
      statusElementId: 'syncStatus',
      getState: () => cloneStatePayload(state),
      applyState: (payload) => {
        applySyncedState(payload).catch((error) => console.error('Failed to apply synced contractor verification state', error));
      },
      getTitle: () => {
        const profile = getProfile();
        return profile.legalName || profile.businessName || `Contractor Verification Suite ${WORKSPACE_ID}`;
      },
    });
  }
  document.getElementById('brandLogo').src = getSettings().logoUrl || BRAND_CONFIG.logoUrl;
  renderNav(); renderDashboard(); addQuickDataPanels(); seedIfEmptyActions();
  $('#backupExportBtn').onclick = exportJSONBackup;
  $('#backupImportInput').onchange = async (e) => { if (e.target.files[0]) await importJSONBackup(e.target.files[0]); };
  $('#printViewBtn').onclick = () => {
    if (activeModule === 'dashboardView') print();
    else {
      const node = document.getElementById(activeModule); if (node) printSection(node);
    }
  };
  $('#moduleSearch').oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    $$('.cvs-nav-btn').forEach(btn => {
      if (!btn.dataset.module || btn.dataset.module === 'dashboardView') return;
      btn.style.display = btn.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  if (workspaceSync) {
    await workspaceSync.load(false);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

init();
