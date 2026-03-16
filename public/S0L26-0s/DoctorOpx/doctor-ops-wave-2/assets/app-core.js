
const DoctorOpsCore = (() => {
  const todayISO = () => new Date().toISOString().slice(0,10);
  function escapeHtml(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function readState(key, seed){
    try{
      const raw = localStorage.getItem(key);
      if(!raw){
        const base = {records: seed || [], audit: []};
        localStorage.setItem(key, JSON.stringify(base));
        return base;
      }
      const parsed = JSON.parse(raw);
      parsed.records ||= [];
      parsed.audit ||= [];
      return parsed;
    }catch(err){
      return {records: seed || [], audit: [{id:crypto.randomUUID(), action:'State parse failure', detail:String(err), at:new Date().toISOString()}]};
    }
  }
  function saveState(key, state){ localStorage.setItem(key, JSON.stringify(state)); }
  function addAudit(state, action, detail){
    state.audit.unshift({id: crypto.randomUUID(), action, detail, at: new Date().toISOString()});
    state.audit = state.audit.slice(0, 300);
  }
  function buildForm(fields){
    return fields.map(field => {
      const attrs = field.required ? 'required' : '';
      const cls = field.full ? 'field full' : (field.type === 'textarea' ? 'field full' : 'field');
      let control = '';
      if(field.type === 'textarea'){
        control = `<textarea id="field-${field.name}" ${attrs}></textarea>`;
      } else if(field.type === 'select'){
        const opts = ['<option value="">Select</option>'].concat((field.options||[]).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`));
        control = `<select id="field-${field.name}" ${attrs}>${opts.join('')}</select>`;
      } else {
        const step = field.type === 'number' ? 'step="0.01"' : '';
        control = `<input id="field-${field.name}" type="${field.type || 'text'}" ${step} ${attrs} />`;
      }
      return `<div class="${cls}"><label for="field-${field.name}">${escapeHtml(field.label)}</label>${control}</div>`;
    }).join('');
  }
  function badgeClass(value){
    const low = String(value || '').toLowerCase();
    if(['high','at risk'].includes(low) || low.includes('high')) return 'badge high';
    if(['elevated'].includes(low) || low.includes('need') || low.includes('pending') || low.includes('overdue') || low.includes('drafting') || low.includes('escalated') || low.includes('stalled')) return 'badge elevated';
    if(['closed','completed','approved','delivered','paid','won','covered','cleared','seen','active'].includes(low)) return 'badge done';
    if(low.includes('routine')) return 'badge routine';
    return 'badge open';
  }
  function fmt(value, field){
    if(value == null || value === '') return '—';
    if(field?.type === 'date') return value;
    if(field?.type === 'number'){
      const num = Number(value);
      return isFinite(num) ? num.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:2}) : value;
    }
    return value;
  }
  function recordMatches(record, config, search, status, priority){
    const blob = JSON.stringify(record).toLowerCase();
    const s = search.trim().toLowerCase();
    if(s && !blob.includes(s)) return false;
    if(status && record[config.statusField] !== status) return false;
    if(priority && record[config.priorityField] !== priority) return false;
    return true;
  }
  function dueMetrics(records, config){
    const today = new Date(todayISO());
    let overdue = 0, dueSoon = 0;
    for(const rec of records){
      const d = rec[config.dueField];
      if(!d) continue;
      const dt = new Date(d);
      const diff = Math.round((dt - today) / 86400000);
      if(diff < 0) overdue++;
      else if(diff <= 7) dueSoon++;
    }
    return {overdue, dueSoon};
  }
  function buildSummary(records, config){
    const total = records.length;
    const statusCounts = {};
    const urgentStatuses = new Set(config.urgentStatuses || []);
    let urgent = 0;
    let high = 0;
    for(const rec of records){
      const st = rec[config.statusField] || 'Unspecified';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      if(urgentStatuses.has(st)) urgent++;
      if(String(rec[config.priorityField]).toLowerCase().includes('high')) high++;
    }
    const {overdue, dueSoon} = dueMetrics(records, config);
    const topStatuses = Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v]) => `${k}: ${v}`).join(' | ') || 'No records yet.';
    const flagged = records.filter(r => String(r[config.priorityField]).toLowerCase().includes('high') || urgentStatuses.has(r[config.statusField])).slice(0,5);
    const follow = flagged.map(r => {
      const main = r.patientName || r.provider || r.teamMember || r.measure || r.item || r.procedure || config.entity;
      const st = r[config.statusField] || 'open';
      const due = r[config.dueField] ? ` / due ${r[config.dueField]}` : '';
      return `• ${main} — ${st}${due}`;
    }).join('\n') || '• No immediate escalations visible.';
    const play = [];
    if(overdue) play.push(`${overdue} record(s) are overdue against the main action date.`);
    if(dueSoon) play.push(`${dueSoon} record(s) come due within seven days.`);
    if(high) play.push(`${high} record(s) are tagged high priority.`);
    if(!play.length) play.push('Current queue is calm enough to stay boring for a moment.');
    return `Operational snapshot\n--------------------\nTotal records: ${total}\nUrgent workflow states: ${urgent}\nTop statuses: ${topStatuses}\n\nRecommended next push\n--------------------\n${play.map(p => `• ${p}`).join('\n')}\n\nFlagged queue\n--------------------\n${follow}`;
  }
  function toCSV(records, fields){
    const header = fields.map(f => `"${String(f.label).replace(/"/g,'""')}"`).join(',');
    const rows = records.map(rec => fields.map(f => `"${String(rec[f.name] ?? '').replace(/"/g,'""')}"`).join(','));
    return [header].concat(rows).join('\n');
  }
  function download(filename, text, type){
    const blob = new Blob([text], {type: type || 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function mount(config){
    const root = document.getElementById('app-root');
    root.innerHTML = `
      <section class="hero">
        <span class="kicker">Doctor Ops Wave II</span>
        <h1>${escapeHtml(config.title)}</h1>
        <p>${escapeHtml(config.tagline)}</p>
      </section>
      <div class="grid grid-2">
        <section class="card">
          <h2>${escapeHtml(config.title)} Workbench</h2>
          <p>Use this surface to create, update, clone, export, import, and audit every ${escapeHtml(config.entity)} in the queue. Static, local-first, and browser-safe. Synthetic data only.</p>
          <form id="record-form" class="form-grid">${buildForm(config.fields)}</form>
          <div class="action-row" style="margin-top:14px">
            <button id="save-btn" class="success" type="button">Save Record</button>
            <button id="reset-btn" class="secondary" type="button">Clear Form</button>
            <button id="export-json-btn" class="secondary" type="button">Export JSON</button>
            <button id="export-csv-btn" class="secondary" type="button">Export CSV</button>
            <label class="button secondary" for="import-json-input">Import JSON</label>
            <input id="import-json-input" type="file" accept="application/json" style="display:none" />
          </div>
          <small class="helper">Each save writes to local browser storage and appends an audit event.</small>
        </section>
        <aside class="card">
          <h2>Generated Summary</h2>
          <div class="summary" id="summary-box"></div>
          <hr class="sep" />
          <div class="notice">Tiny but useful goblin-proof features: search, status filtering, priority filtering, clone, edit, delete, JSON import/export, CSV export, and a running audit log.</div>
        </aside>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="filters">
          <div class="field"><label for="search-input">Search</label><input id="search-input" type="text" placeholder="Search across records..." /></div>
          <div class="field"><label for="status-filter">Status Filter</label><select id="status-filter"><option value="">All statuses</option>${(config.statusOptions||[]).map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div>
          <div class="field"><label for="priority-filter">Priority Filter</label><select id="priority-filter"><option value="">All priorities</option>${(config.priorityOptions||[]).map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div>
        </div>
        <div class="stat-row" style="margin-top:16px">
          <div class="stat"><div class="label">Total</div><div class="value" id="stat-total">0</div></div>
          <div class="stat"><div class="label">Urgent States</div><div class="value" id="stat-urgent">0</div></div>
          <div class="stat"><div class="label">Due Soon</div><div class="value" id="stat-due">0</div></div>
          <div class="stat"><div class="label">Overdue</div><div class="value" id="stat-overdue">0</div></div>
        </div>
      </section>
      <section class="card" style="margin-top:16px">
        <h2>Records</h2>
        <div class="table-wrap">
          <table>
            <thead><tr>${config.columns.map(name => {
              const field = config.fields.find(f => f.name === name) || {label:name};
              return `<th>${escapeHtml(field.label)}</th>`;
            }).join('')}<th>Actions</th></tr></thead>
            <tbody id="records-body"></tbody>
          </table>
        </div>
      </section>
      <section class="card" style="margin-top:16px">
        <h2>Audit Log</h2>
        <div class="log" id="audit-log"></div>
      </section>
    `;
    const stateKey = config.storageKey;
    const state = readState(stateKey, config.seedRecords);
    let editingId = null;
    const saveBtn = document.getElementById('save-btn');
    const resetBtn = document.getElementById('reset-btn');
    const exportJsonBtn = document.getElementById('export-json-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const importInput = document.getElementById('import-json-input');
    const recordsBody = document.getElementById('records-body');
    const auditLog = document.getElementById('audit-log');
    const summaryBox = document.getElementById('summary-box');
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    const priorityFilter = document.getElementById('priority-filter');

    function resetForm(){
      editingId = null;
      saveBtn.textContent = 'Save Record';
      for(const field of config.fields){
        const el = document.getElementById(`field-${field.name}`);
        if(el) el.value = '';
      }
    }
    function getFormRecord(){
      const out = {};
      for(const field of config.fields){
        const el = document.getElementById(`field-${field.name}`);
        let val = el?.value ?? '';
        if(field.type === 'number' && val !== '') val = Number(val);
        out[field.name] = val;
      }
      return out;
    }
    function populateForm(record){
      editingId = record.id;
      saveBtn.textContent = 'Update Record';
      for(const field of config.fields){
        const el = document.getElementById(`field-${field.name}`);
        if(el) el.value = record[field.name] ?? '';
      }
      window.scrollTo({top:0, behavior:'smooth'});
    }
    function filteredRecords(){
      return state.records.filter(rec => recordMatches(rec, config, searchInput.value, statusFilter.value, priorityFilter.value));
    }
    function render(){
      const rows = filteredRecords();
      recordsBody.innerHTML = rows.length ? rows.map(record => {
        const cells = config.columns.map(name => {
          const field = config.fields.find(f => f.name === name) || {name};
          const value = record[name];
          const cell = (name === config.statusField || name === config.priorityField)
            ? `<span class="${badgeClass(value)}">${escapeHtml(fmt(value, field))}</span>`
            : escapeHtml(fmt(value, field));
          return `<td>${cell}</td>`;
        }).join('');
        return `<tr>${cells}<td><div class="action-row"><button class="mini" data-action="edit" data-id="${record.id}">Edit</button><button class="mini secondary" data-action="clone" data-id="${record.id}">Clone</button><button class="mini danger" data-action="delete" data-id="${record.id}">Delete</button></div></td></tr>`;
      }).join('') : `<tr><td colspan="${config.columns.length + 1}"><div class="empty">No records match the current filters.</div></td></tr>`;
      const urgentStatuses = new Set(config.urgentStatuses || []);
      const urgentCount = state.records.filter(r => urgentStatuses.has(r[config.statusField])).length;
      const due = dueMetrics(state.records, config);
      document.getElementById('stat-total').textContent = state.records.length;
      document.getElementById('stat-urgent').textContent = urgentCount;
      document.getElementById('stat-due').textContent = due.dueSoon;
      document.getElementById('stat-overdue').textContent = due.overdue;
      summaryBox.textContent = buildSummary(state.records, config);
      auditLog.innerHTML = state.audit.length ? state.audit.map(item => `<div class="log-item"><strong>${escapeHtml(item.action)}</strong><div class="meta">${escapeHtml(new Date(item.at).toLocaleString())}</div><div style="margin-top:6px">${escapeHtml(item.detail)}</div></div>`).join('') : `<div class="empty">No audit events yet.</div>`;
      saveState(stateKey, state);
    }
    saveBtn.addEventListener('click', () => {
      const data = getFormRecord();
      const labelField = ['patientName','provider','teamMember','measure','item','procedure','vaccine'].find(k => data[k]);
      const name = data[labelField] || config.entity;
      if(editingId){
        const idx = state.records.findIndex(r => r.id === editingId);
        if(idx >= 0){
          state.records[idx] = {...state.records[idx], ...data, updatedAt:new Date().toISOString()};
          addAudit(state, 'Record updated', `${name} updated in ${config.title}.`);
        }
      } else {
        const rec = {...data, id: crypto.randomUUID(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
        state.records.unshift(rec);
        addAudit(state, 'Record created', `${name} created in ${config.title}.`);
      }
      resetForm(); render();
    });
    resetBtn.addEventListener('click', resetForm);
    exportJsonBtn.addEventListener('click', () => { download(`${config.slug}.json`, JSON.stringify(state, null, 2), 'application/json'); addAudit(state, 'JSON exported', `${config.title} state exported as JSON.`); render(); });
    exportCsvBtn.addEventListener('click', () => { download(`${config.slug}.csv`, toCSV(state.records, config.fields), 'text/csv'); addAudit(state, 'CSV exported', `${config.title} records exported as CSV.`); render(); });
    importInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if(!file) return;
      try{
        const raw = await file.text();
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed.records)){
          state.records = parsed.records;
          if(Array.isArray(parsed.audit)) state.audit = parsed.audit.concat(state.audit).slice(0,300);
          addAudit(state, 'JSON imported', `${file.name} imported into ${config.title}.`);
          resetForm(); render();
        }else{ alert('JSON file must contain a records array.'); }
      }catch(err){ alert('Unable to import JSON: ' + err.message); }
      event.target.value = '';
    });
    [searchInput, statusFilter, priorityFilter].forEach(el => el.addEventListener('input', render));
    [statusFilter, priorityFilter].forEach(el => el.addEventListener('change', render));
    recordsBody.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if(!button) return;
      const id = button.dataset.id; const action = button.dataset.action;
      const record = state.records.find(r => r.id === id); if(!record) return;
      const name = record.patientName || record.provider || record.teamMember || record.measure || record.item || record.procedure || config.entity;
      if(action === 'edit'){ populateForm(record); }
      else if(action === 'clone'){ const clone = {...record, id: crypto.randomUUID(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()}; state.records.unshift(clone); addAudit(state, 'Record cloned', `${name} cloned in ${config.title}.`); render(); }
      else if(action === 'delete'){ if(confirm(`Delete this ${config.entity}?`)){ state.records = state.records.filter(r => r.id !== id); addAudit(state, 'Record deleted', `${name} deleted from ${config.title}.`); if(editingId === id) resetForm(); render(); } }
    });
    if(!state.audit.length && state.records.length){ addAudit(state, 'Seed loaded', `${state.records.length} synthetic record(s) loaded into ${config.title}.`); }
    render();
  }
  return { mount };
})();
