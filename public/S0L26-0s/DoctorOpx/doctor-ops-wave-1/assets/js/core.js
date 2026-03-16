
(function(){
  function uid(prefix){ return (prefix || 'rec') + '_' + Math.random().toString(36).slice(2,10) + '_' + Date.now().toString(36); }
  function isoNow(){ return new Date().toISOString(); }
  function formatDate(v){
    if(!v) return '—';
    const d = new Date(v);
    if(isNaN(d.getTime())) return v;
    return d.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
  }
  function formatDateTime(v){
    if(!v) return '—';
    const d = new Date(v);
    if(isNaN(d.getTime())) return v;
    return d.toLocaleString(undefined, {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  }
  function daysBetween(a,b){
    const da = new Date(a), db = new Date(b || Date.now());
    if(isNaN(da.getTime()) || isNaN(db.getTime())) return null;
    return Math.floor((db-da)/(1000*60*60*24));
  }
  function esc(s){
    return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  }
  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function download(name, text, type){
    const blob = new Blob([text], {type:type || 'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    URL.revokeObjectURL(a.href); a.remove();
  }
  function toCSV(rows){
    if(!rows.length) return '';
    const headers = Array.from(rows.reduce((set,row)=>{ Object.keys(row).forEach(k=>set.add(k)); return set; }, new Set()));
    const q = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replaceAll('"','""') + '"' : s;
    };
    return [headers.join(','), ...rows.map(r => headers.map(h => q(r[h])).join(','))].join('\n');
  }
  function loadState(key, seed){
    try{
      const raw = localStorage.getItem(key);
      if(!raw){
        localStorage.setItem(key, JSON.stringify(seed));
        return clone(seed);
      }
      const parsed = JSON.parse(raw);
      if(!parsed.records) parsed.records = [];
      if(!parsed.audit) parsed.audit = [];
      return parsed;
    }catch(err){
      return clone(seed);
    }
  }
  function saveState(key, state){ localStorage.setItem(key, JSON.stringify(state)); }
  function getField(form, field){
    const el = form.querySelector(`[name="${field.name}"]`);
    if(!el) return '';
    if(field.type === 'checkbox') return !!el.checked;
    return el.value == null ? '' : String(el.value).trim();
  }
  function setField(form, field, value){
    const el = form.querySelector(`[name="${field.name}"]`);
    if(!el) return;
    if(field.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
  }
  function fieldEl(field){
    const wrap = document.createElement('div');
    wrap.className = 'field' + (field.full ? ' full' : '');
    const label = document.createElement('label');
    label.textContent = field.label;
    wrap.appendChild(label);
    let input;
    if(field.type === 'select'){
      input = document.createElement('select');
      (field.options || []).forEach(opt => {
        const o = document.createElement('option');
        if(typeof opt === 'string'){ o.value = opt; o.textContent = opt; }
        else { o.value = opt.value; o.textContent = opt.label; }
        input.appendChild(o);
      });
    } else if(field.type === 'textarea'){
      input = document.createElement('textarea');
      input.rows = field.rows || 5;
      if(field.placeholder) input.placeholder = field.placeholder;
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      if(field.placeholder) input.placeholder = field.placeholder;
      if(field.step) input.step = field.step;
    }
    input.name = field.name;
    wrap.appendChild(input);
    if(field.help){
      const small = document.createElement('small');
      small.textContent = field.help;
      wrap.appendChild(small);
    }
    return wrap;
  }
  function badgeTone(value){
    const v = String(value || '').toLowerCase();
    if(/critical|emergent|urgent|major|high|denied|open|needs|overdue/.test(v)) return 'danger';
    if(/pending|draft|review|submitted|due today|expedited|medium|moderate|waiting/.test(v)) return 'warn';
    if(/approved|completed|closed|stable|ready|final|normal|good|yes|resolved/.test(v)) return 'ok';
    return 'info';
  }

  function createApp(config){
    const key = `doctor_ops_suite:${config.id}:state`;
    const seed = {
      records: clone(config.sampleRecords || []).map(r => config.compute({...r, id:r.id || uid(config.id), createdAt:r.createdAt || isoNow(), updatedAt:r.updatedAt || isoNow()}, {daysBetween})),
      audit: [{id:uid('audit'), at:isoNow(), message:'Initialized app with synthetic demo records.'}]
    };
    const state = loadState(key, seed);
    let selectedId = state.records[0]?.id || null;
    let editingId = null;

    const form = document.getElementById('record-form');
    const grid = form.querySelector('.form-grid');
    const metricsEl = document.getElementById('metrics');
    const tbody = document.getElementById('records-body');
    const detailMeta = document.getElementById('detail-meta');
    const preview = document.getElementById('detail-preview');
    const audit = document.getElementById('audit-list');
    const search = document.getElementById('search');
    const statusFilter = document.getElementById('status-filter');
    const priorityFilter = document.getElementById('priority-filter');

    document.getElementById('app-title').textContent = config.title;
    document.getElementById('app-subtitle').textContent = config.subtitle;
    document.getElementById('app-blurb').textContent = config.blurb;
    document.getElementById('preview-title').textContent = config.previewTitle;
    document.getElementById('record-label').textContent = config.recordLabel;
    document.getElementById('empty-copy').textContent = config.emptyCopy || 'No records yet.';
    document.title = config.title + ' — Doctor Ops Wave I';

    config.fields.forEach(f => grid.appendChild(fieldEl(f)));
    (config.statusOptions || []).forEach(v => {
      const o = document.createElement('option'); o.value = v; o.textContent = v; statusFilter.appendChild(o);
    });
    if(config.priorityOptions && config.priorityOptions.length){
      (config.priorityOptions || []).forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v; priorityFilter.appendChild(o);
      });
    } else {
      priorityFilter.parentElement.style.display = 'none';
    }

    function persist(){ saveState(key, state); }
    function log(msg){
      state.audit.unshift({id:uid('audit'), at:isoNow(), message:msg});
      state.audit = state.audit.slice(0,120);
      persist();
      renderAudit();
    }
    function normalize(raw, isUpdate){
      let rec = {...raw};
      rec.id = raw.id || uid(config.id);
      rec.createdAt = isUpdate ? raw.createdAt : (raw.createdAt || isoNow());
      rec.updatedAt = isoNow();
      rec = config.compute(rec, {daysBetween});
      return rec;
    }
    function fill(rec){
      config.fields.forEach(f => setField(form, f, rec?.[f.name]));
    }
    function clearForm(){
      editingId = null;
      document.getElementById('form-mode').textContent = 'Create';
      form.reset();
      fill(config.defaultValues || {});
    }
    function current(){
      return state.records.find(r => r.id === selectedId) || null;
    }
    function filtered(){
      const q = String(search.value || '').toLowerCase().trim();
      const st = statusFilter.value;
      const pr = priorityFilter.value;
      let rows = [...state.records];
      if(q) rows = rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
      if(st) rows = rows.filter(r => String(r[config.statusField || 'status'] || '') === st);
      if(pr && config.priorityField) rows = rows.filter(r => String(r[config.priorityField] || '') === pr);
      rows = config.sortRecords ? config.sortRecords(rows, {daysBetween}) : rows.sort((a,b)=> String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return rows;
    }
    function renderMetrics(){
      metricsEl.innerHTML = '';
      config.metrics(filtered(), {daysBetween}).forEach(m => {
        const d = document.createElement('div');
        d.className = 'metric ' + (m.tone || 'info');
        d.innerHTML = `<strong>${esc(m.value)}</strong><span>${esc(m.label)}</span>${m.subtext ? `<small>${esc(m.subtext)}</small>` : ''}`;
        metricsEl.appendChild(d);
      });
    }
    function renderTable(){
      const rows = filtered();
      tbody.innerHTML = '';
      if(!rows.length){
        tbody.innerHTML = `<tr><td colspan="${config.columns.length + 1}"><div class="empty">${esc(config.emptyCopy || 'No matching records.')}</div></td></tr>`;
        return;
      }
      rows.forEach(rec => {
        const tr = document.createElement('tr');
        if(rec.id === selectedId) tr.style.background = 'rgba(255,255,255,.05)';
        tr.addEventListener('click', (e) => {
          if(e.target.closest('button')) return;
          selectedId = rec.id; renderAll();
        });
        config.columns.forEach(col => {
          const td = document.createElement('td');
          let val = typeof col.get === 'function' ? col.get(rec, {daysBetween}) : rec[col.key];
          if(val === undefined || val === null || val === '') val = '—';
          if(col.type === 'date') val = formatDate(val);
          if(col.type === 'datetime') val = formatDateTime(val);
          if(col.badge) td.innerHTML = `<span class="badge ${badgeTone(val)}">${esc(val)}</span>`;
          else td.textContent = String(val);
          tr.appendChild(td);
        });
        const a = document.createElement('td');
        a.innerHTML = `<div class="toolbar">
          <button class="btn ghost" data-a="edit">Edit</button>
          <button class="btn ghost" data-a="clone">Clone</button>
          <button class="btn ghost" data-a="delete">Delete</button>
        </div>`;
        a.querySelector('[data-a="edit"]').addEventListener('click', () => {
          editingId = rec.id; document.getElementById('form-mode').textContent = 'Update'; fill(rec);
          window.scrollTo({top:0, behavior:'smooth'});
        });
        a.querySelector('[data-a="clone"]').addEventListener('click', () => {
          const c = normalize({...rec, id:null, createdAt:null, updatedAt:null}, false);
          state.records.unshift(c); selectedId = c.id; persist(); log(`Cloned ${config.recordLabel} ${config.recordTitle(c)}.`); renderAll();
        });
        a.querySelector('[data-a="delete"]').addEventListener('click', () => {
          state.records = state.records.filter(r => r.id !== rec.id);
          if(selectedId === rec.id) selectedId = state.records[0]?.id || null;
          persist(); log(`Deleted ${config.recordLabel} ${config.recordTitle(rec)}.`); renderAll();
        });
        tr.appendChild(a);
        tbody.appendChild(tr);
      });
    }
    function renderDetail(){
      const rec = current();
      const title = document.getElementById('selected-title');
      if(!rec){
        title.textContent = 'No record selected';
        detailMeta.innerHTML = `<div class="empty">${esc(config.emptyCopy || 'No records yet.')}</div>`;
        preview.textContent = '';
        return;
      }
      title.textContent = config.recordTitle(rec);
      detailMeta.innerHTML = `<div class="kv">${
        config.detailKeys.map(k => {
          const field = config.fields.find(f => f.name === k);
          const label = field ? field.label : k;
          let val = rec[k];
          if(field && field.type === 'date') val = formatDate(val);
          return `<strong>${esc(label)}</strong><span>${esc(val || '—')}</span>`;
        }).join('')
      }</div>`;
      preview.textContent = config.preview(rec, {formatDate, formatDateTime, daysBetween});
    }
    function renderAudit(){
      audit.innerHTML = '';
      state.audit.slice(0,20).forEach(item => {
        const d = document.createElement('div');
        d.className = 'audit-item';
        d.innerHTML = `<strong>${esc(item.message)}</strong><span>${esc(formatDateTime(item.at))}</span>`;
        audit.appendChild(d);
      });
    }
    function renderAll(){
      renderMetrics(); renderTable(); renderDetail(); renderAudit();
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = {};
      config.fields.forEach(f => raw[f.name] = getField(form, f));
      if(editingId){
        const idx = state.records.findIndex(r => r.id === editingId);
        if(idx >= 0){
          state.records[idx] = normalize({...state.records[idx], ...raw}, true);
          selectedId = state.records[idx].id;
          log(`Updated ${config.recordLabel} ${config.recordTitle(state.records[idx])}.`);
        }
      } else {
        const rec = normalize(raw, false);
        state.records.unshift(rec); selectedId = rec.id;
        log(`Created ${config.recordLabel} ${config.recordTitle(rec)}.`);
      }
      persist(); clearForm(); renderAll();
    });

    document.getElementById('reset-form').addEventListener('click', clearForm);
    document.getElementById('export-json').addEventListener('click', () => {
      download(`${config.id}.json`, JSON.stringify(state, null, 2), 'application/json'); log(`Exported ${config.title} JSON package.`);
    });
    document.getElementById('export-csv').addEventListener('click', () => {
      download(`${config.id}.csv`, toCSV(state.records), 'text/csv;charset=utf-8'); log(`Exported ${config.title} CSV package.`);
    });
    document.getElementById('export-preview').addEventListener('click', () => {
      const rec = current(); if(!rec) return;
      const name = `${config.id}-${config.recordTitle(rec).replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.txt`;
      download(name, config.preview(rec, {formatDate, formatDateTime, daysBetween}), 'text/plain;charset=utf-8');
      log(`Exported generated summary for ${config.recordTitle(rec)}.`);
    });
    document.getElementById('seed-demo').addEventListener('click', () => {
      state.records = clone(seed.records); selectedId = state.records[0]?.id || null;
      state.audit.unshift({id:uid('audit'), at:isoNow(), message:'Demo records restored.'});
      persist(); clearForm(); renderAll();
    });
    document.getElementById('clear-all').addEventListener('click', () => {
      state.records = []; selectedId = null;
      state.audit.unshift({id:uid('audit'), at:isoNow(), message:'All records cleared.'});
      persist(); clearForm(); renderAll();
    });
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0]; if(!file) return;
      const text = await file.text();
      try{
        const parsed = JSON.parse(text);
        const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.records) ? parsed.records : []);
        state.records = rows.map(r => normalize(r, !!r.id));
        selectedId = state.records[0]?.id || null;
        log(`Imported ${state.records.length} ${config.recordLabel} records from JSON.`);
        persist(); renderAll();
      }catch(err){
        alert('Import failed. Provide a JSON array or an object with { records: [...] }.');
      } finally {
        e.target.value = '';
      }
    });
    [search,statusFilter,priorityFilter].forEach(el => el.addEventListener('input', renderAll));
    clearForm();
    renderAll();
  }

  window.DOCTOR_OPS = { createApp, formatDate, formatDateTime, daysBetween };
})();
