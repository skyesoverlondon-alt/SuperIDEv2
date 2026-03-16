
window.DoctorAICore = (() => {
  const urgentWords = [
    {term:'chest pain', flag:'Possible acute cardiac symptom'},
    {term:'shortness of breath', flag:'Respiratory symptom needs attention'},
    {term:'stroke', flag:'Possible neurologic emergency language'},
    {term:'weakness', flag:'Neurologic or systemic decline signal'},
    {term:'syncope', flag:'Syncope or near-syncope concern'},
    {term:'bleeding', flag:'Bleeding concern'},
    {term:'fever', flag:'Infectious process language'},
    {term:'worsening', flag:'Trend is worsening'},
    {term:'ed visit', flag:'Recent acute utilization'},
    {term:'readmission', flag:'Readmission risk language'},
    {term:'abnormal', flag:'Abnormal result language'},
    {term:'critical', flag:'Explicit critical language'},
    {term:'urgent', flag:'Explicit urgency language'},
    {term:'denied', flag:'Payer friction / work queue risk'},
    {term:'missing', flag:'Missing item / packet gap'},
  ];
  const knownFormats = ['patientName','chiefConcern','messageType','owner','visitType','requestType','payer','specialty','topic','conditionSet','procedure','measure','resultType','campaign','riskDomain'];
  function escapeHtml(value){ return String(value ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
  function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
  function clone(x){ return JSON.parse(JSON.stringify(x));}
  function readState(storageKey, seedRecords){
    const raw = localStorage.getItem(storageKey);
    if(raw){
      try{
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed.records) && Array.isArray(parsed.audit)) return parsed;
      }catch(err){}
    }
    return {
      records: clone(seedRecords).map(r => ({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...r
      })),
      audit: []
    };
  }
  function saveState(storageKey, state){ localStorage.setItem(storageKey, JSON.stringify(state)); }
  function addAudit(state, action, detail){
    state.audit.unshift({id:crypto.randomUUID(), at:new Date().toISOString(), action, detail});
    state.audit = state.audit.slice(0, 400);
  }
  function buildForm(fields){
    return fields.map(field => {
      const wide = field.type === 'textarea' ? ' wide' : '';
      const options = (field.options || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      const control = field.type === 'textarea'
        ? `<textarea id="field-${field.name}" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>`
        : field.type === 'select'
          ? `<select id="field-${field.name}"><option value="">Select ${escapeHtml(field.label)}</option>${options}</select>`
          : `<input id="field-${field.name}" type="${escapeHtml(field.type || 'text')}" placeholder="${escapeHtml(field.placeholder || '')}" />`;
      return `<div class="field${wide}"><label for="field-${field.name}">${escapeHtml(field.label)}</label>${control}</div>`;
    }).join('');
  }
  function fmt(value, field){
    if(value === null || value === undefined || value === '') return '—';
    if(field.type === 'date'){
      const d = new Date(value);
      return isNaN(d) ? value : d.toLocaleDateString();
    }
    return String(value);
  }
  function badgeClass(value){
    return 'badge ' + String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').split('-').filter(Boolean).map((part, idx) => `${idx===0?'':'-'}${part}`).join('').replace(/^/, String(value).toLowerCase().includes('priority') ? 'priority-' : '');
  }
  function recordMatches(rec, config, q, status, priority){
    const hay = config.fields.map(f => String(rec[f.name] ?? '')).join(' ').toLowerCase();
    const query = String(q || '').trim().toLowerCase();
    if(query && !hay.includes(query)) return false;
    if(status && String(rec[config.statusField] || '') !== status) return false;
    if(priority && String(rec[config.priorityField] || '') !== priority) return false;
    return true;
  }
  function dueMetrics(records, config){
    const today = new Date();
    today.setHours(0,0,0,0);
    let overdue = 0, dueSoon = 0;
    for(const record of records){
      const raw = record[config.dueField];
      if(!raw) continue;
      const due = new Date(raw);
      due.setHours(0,0,0,0);
      const diffDays = Math.round((due - today) / 86400000);
      if(diffDays < 0) overdue++;
      else if(diffDays <= 7) dueSoon++;
    }
    return {overdue, dueSoon};
  }
  function recordLabel(record){
    for(const key of knownFormats){
      if(record[key]) return record[key];
    }
    return record.patientName || record.id;
  }
  function topStatuses(records, config){
    const counts = {};
    records.forEach(r => counts[r[config.statusField] || 'unlabeled'] = (counts[r[config.statusField] || 'unlabeled'] || 0) + 1);
    return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,4).map(([name,count]) => `${name} (${count})`).join(', ') || 'None';
  }
  function summarizeRecords(records, config){
    const urgentStatuses = new Set(config.urgentStatuses || ['critical','escalated','intervene now','urgent','appeal needed','hold']);
    const urgent = records.filter(r => urgentStatuses.has(String(r[config.statusField] || '').toLowerCase())).length;
    const due = dueMetrics(records, config);
    const high = records.filter(r => ['high','urgent','critical'].includes(String(r[config.priorityField] || '').toLowerCase())).length;
    const flagged = records.slice().sort((a,b) => {
      const pa = scorePriority(a[config.priorityField]); const pb = scorePriority(b[config.priorityField]);
      return pb-pa;
    }).slice(0,5).map(r => `• ${recordLabel(r)} — ${r[config.statusField] || 'unknown'} / ${r[config.priorityField] || 'no priority'}${r[config.dueField] ? ` / due ${r[config.dueField]}` : ''}`).join('\n') || '• No records';
    return `Queue summary
------------
Total records: ${records.length}
High-priority records: ${high}
Urgent workflow states: ${urgent}
Due within 7 days: ${due.dueSoon}
Overdue: ${due.overdue}
Top statuses: ${topStatuses(records, config)}

Flagged queue
------------
${flagged}`;
  }
  function scorePriority(p){
    const v = String(p || '').toLowerCase();
    if(['critical'].includes(v)) return 4;
    if(['urgent','high'].includes(v)) return 3;
    if(['important','elevated','moderate'].includes(v)) return 2;
    return 1;
  }
  function scoreStatus(s){
    const v = String(s || '').toLowerCase();
    if(['critical','escalated','intervene now','urgent','hold','appeal needed','needs clinician review'].includes(v)) return 4;
    if(['under review','in progress','assigned','working','pending items','awaiting data','awaiting response'].includes(v)) return 2;
    if(['closed','approved','sent','ready','active','stabilized','signed off','scheduled'].includes(v)) return -1;
    return 0;
  }
  function analyzeRecord(record, config){
    const text = config.fields.map(f => String(record[f.name] ?? '')).join(' \n ').toLowerCase();
    const flags = [];
    urgentWords.forEach(item => { if(text.includes(item.term)) flags.push(item.flag); });
    const missing = config.fields.filter(f => !record[f.name]).map(f => f.label);
    const dueRaw = record[config.dueField];
    let dueState = 'No due date';
    let dueDays = null;
    if(dueRaw){
      const today = new Date();
      today.setHours(0,0,0,0);
      const due = new Date(dueRaw);
      due.setHours(0,0,0,0);
      dueDays = Math.round((due - today) / 86400000);
      if(dueDays < 0) dueState = `${Math.abs(dueDays)} day(s) overdue`;
      else if(dueDays === 0) dueState = 'Due today';
      else if(dueDays <= 7) dueState = `Due in ${dueDays} day(s)`;
      else dueState = `Due in ${dueDays} day(s)`;
    }
    const rawScore = scorePriority(record[config.priorityField]) + scoreStatus(record[config.statusField]) + (flags.length >= 3 ? 2 : flags.length > 0 ? 1 : 0) + (dueDays !== null && dueDays < 0 ? 2 : dueDays !== null && dueDays <= 2 ? 1 : 0);
    const urgency = rawScore >= 7 ? 'critical' : rawScore >= 5 ? 'high' : rawScore >= 3 ? 'moderate' : 'routine';
    const subject = recordLabel(record);
    const compactFacts = config.fields.filter(f => record[f.name]).slice(0,7).map(f => `${f.label}: ${record[f.name]}`).join('\n');
    const recommendations = [];
    if(missing.length) recommendations.push(`Fill missing data: ${missing.slice(0,4).join(', ')}${missing.length > 4 ? '…' : ''}.`);
    if(dueDays !== null && dueDays < 0) recommendations.push('Queue immediate catch-up action because the case is overdue.');
    else if(dueDays !== null && dueDays <= 2) recommendations.push('Make same-day or next-day progress to keep the timeline from slipping.');
    if(flags.length) recommendations.push(`Review flagged language: ${flags.slice(0,3).join('; ')}${flags.length > 3 ? '; …' : ''}.`);
    if(!recommendations.length) recommendations.push('Maintain routine progression and verify documentation completeness.');
    return {subject, flags, missing, dueState, urgency, score:rawScore, compactFacts, recommendations};
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
  function chooseRecord(state, activeRecordId){
    return state.records.find(r => r.id === activeRecordId) || state.records[0] || null;
  }
  function buildAIOutput(kind, record, config, state){
    const a = analyzeRecord(record, config);
    const status = record[config.statusField] || 'unspecified';
    const priority = record[config.priorityField] || 'unspecified';
    const due = record[config.dueField] || 'not set';
    const commonHeader = `${config.title} — ${a.subject}\nStatus: ${status}\nPriority: ${priority}\nTimeline: ${a.dueState}\nAI urgency: ${a.urgency.toUpperCase()}\n`;
    const bullets = (items) => items.map(x => `• ${x}`).join('\n') || '• None';
    switch(kind){
      case 'summary':
        return `${commonHeader}
Structured summary
------------------
${a.compactFacts}

Key signals
-----------
${bullets(a.flags.length ? a.flags : ['No explicit high-risk language detected in the available fields.'])}

Recommended push
----------------
${bullets(a.recommendations)}`;
      case 'triage':
        return `${commonHeader}
Triage recommendation
---------------------
Suggested lane: ${a.urgency === 'critical' ? 'Immediate clinician attention / same-day escalation' : a.urgency === 'high' ? 'Rapid nurse or clinician review' : a.urgency === 'moderate' ? 'Active work queue, next available reviewer' : 'Routine workflow lane'}

Why this landed there
---------------------
${bullets([
  `Status posture contributes to urgency: ${status}`,
  `Priority posture contributes to urgency: ${priority}`,
  `Timeline pressure: ${a.dueState}`,
  ...(a.flags.slice(0,3))
])}

Ownership suggestion
--------------------
${config.entity} should be routed to the most appropriate clinical or ops owner, with any missing data closed before final action when possible.`;
      case 'plan':
        return `${commonHeader}
Next-step plan
--------------
1. Confirm the immediate owner and set a real completion target before this case becomes furniture.
2. Close documentation gaps: ${a.missing.slice(0,4).join(', ') || 'No major field gaps detected'}.
3. Execute the domain-specific action for ${config.entity.toLowerCase()} handling.
4. Reassess after the next meaningful event and document the result in the audit trail.

Micro-checklist
---------------
${bullets(a.recommendations)}`;
      case 'patient_message':
        return `${commonHeader}
Patient-facing draft
--------------------
Hello ${record.patientName || 'there'},

We reviewed your ${record.chiefConcern || record.topic || record.resultType || record.reason || record.requestType || 'case'} and wanted to follow up. At this point, the team wants to make sure the next step happens on time.

What we need from you:
${bullets([
  record.followUp || record.nextAction || record.clinicianGoal || 'Please complete the next recommended step.',
  due !== 'not set' ? `Target timing: ${due}.` : 'We will coordinate timing with you.',
  a.flags.length ? 'Please seek urgent care sooner if symptoms worsen or if any serious warning signs appear.' : 'Contact the office sooner if symptoms worsen.'
])}

We will keep this moving on our side as well.`;
      case 'differential':
        return `${commonHeader}
Differential draft
------------------
Most plausible buckets from the current signals:
${bullets([
  `Primary working bucket related to ${record.chiefConcern || 'the presenting concern'}`,
  'Common high-prevalence explanation that still fits the available data',
  'Higher-risk explanation that should not be missed given the current language',
  'Alternative non-obvious bucket if the first-pass workup is unrevealing'
])}

Missing data to tighten the picture
-----------------------------------
${bullets(a.missing.length ? a.missing : ['No obvious field gaps; next refinement depends on clinician judgment and additional testing.'])}

Do-not-miss note
----------------
${a.flags.length ? bullets(a.flags) : '• No explicit alarm language found, but clinician judgment remains the real boss here.'}`;
      case 'medical_necessity':
        return `${commonHeader}
Medical necessity draft
-----------------------
This request is clinically supported based on the documented indication, current disease burden, and the failure or inadequacy of prior conservative management where listed. The available record shows: ${record.diagnosis || record.reason || record.requestType || 'the requested service'} with supporting evidence including ${record.clinicalEvidence || record.testing || record.resultSummary || 'documented clinical findings'}. Prior efforts and/or treatment history include ${record.failedTherapies || record.currentPlan || 'previous management already attempted'}. Delaying or denying this request risks ongoing symptoms, deterioration, avoidable utilization, or reduced treatment effectiveness.

Evidence checklist
------------------
${bullets(a.recommendations)}`;
      case 'appeal':
        return `${commonHeader}
Appeal draft
------------
We respectfully request reconsideration of the prior determination. The submitted request is supported by the patient’s clinical presentation, documented diagnosis, and the history of prior management. Current documentation reflects ${record.clinicalEvidence || record.testing || record.diagnosis || 'medical facts already present in the record'}. Additional context shows that conservative measures or earlier therapies have been tried and were insufficient, contraindicated, or poorly tolerated where applicable. Approval is medically appropriate to prevent delay in indicated care.

Packet fixes before resubmission
--------------------------------
${bullets(a.missing.length ? a.missing : ['No major packet gaps identified from the available fields.'])}`;
      case 'referral':
        return `${commonHeader}
Referral letter draft
---------------------
Dear ${record.specialty || 'Specialist Team'},

I am referring ${record.patientName || 'this patient'} for evaluation of ${record.reason || record.chiefConcern || 'the presenting issue'}. Relevant history includes ${record.history || 'see chart for history details'}. Existing testing and findings: ${record.testing || record.labs || 'limited data currently attached'}. Current management includes ${record.meds || record.currentPlan || 'ongoing treatment as documented'}.

Primary referral question
-------------------------
Please evaluate for ${record.reason || record.specialty || 'the indicated concern'} and advise on further diagnostic or treatment recommendations.

Urgency note
------------
Current urgency appears ${a.urgency}. Timeline target: ${record.targetDate || record.followUpDate || 'not specified'}.`;
      case 'instructions':
        return `${commonHeader}
Patient instructions
--------------------
What this means:
${record.clinicalPlan || record.nextAction || 'Your care plan has been updated based on today’s review.'}

What to do now:
${bullets([
  record.followUp || record.nextAction || 'Complete the next step recommended by your care team.',
  record.medHolds ? `Medication note: ${record.medHolds}` : 'Take medications exactly as directed unless your clinician told you otherwise.',
  due !== 'not set' ? `Pay attention to this timing goal: ${due}.` : 'Watch for a follow-up message with timing details.'
])}

Get help sooner if:
${bullets((record.redFlags || record.notes || 'symptoms are worsening, severe, or alarming').split(/[,;]\s*/).slice(0,5))}`;
      case 'coding':
        return `${commonHeader}
Coding & documentation review
-----------------------------
Signals that support complexity:
${bullets([
  record.problemsAddressed || 'Problems addressed not clearly specified',
  record.dataReviewed || 'Data reviewed not clearly specified',
  record.riskElements || 'Risk elements not clearly specified',
  record.timeSpent ? `Documented time: ${record.timeSpent} minutes` : 'Time not documented'
])}

Potential documentation gaps
----------------------------
${bullets(a.missing.length ? a.missing : ['No obvious field-level gaps, but note specificity still matters.'])}

Practical fix list
------------------
${bullets([
  'State the number and acuity of problems clearly.',
  'Specify data reviewed or independently interpreted.',
  'Name medication changes, testing, or referral risk when relevant.',
  'Keep time and counseling language aligned with the final code strategy.'
])}`;
      case 'risk':
        return `${commonHeader}
Risk review
-----------
Overall risk posture: ${a.urgency.toUpperCase()}.

Risk drivers
------------
${bullets(a.flags.length ? a.flags : ['No explicit high-risk keywords detected; review broader clinical context anyway.'])}

Operational concerns
--------------------
${bullets([
  `Queue pressure: ${a.dueState}`,
  a.missing.length ? `Missing data could weaken safe decision-making: ${a.missing.slice(0,4).join(', ')}` : 'Field completeness looks reasonably solid.',
  `Current state: ${status} / ${priority}`
])}`;
      case 'outreach':
        return `${commonHeader}
Outreach script pack
--------------------
Phone opener:
“Hello ${record.patientName || ''}, this is the care team calling about ${record.reason || record.measure || record.resultType || record.campaign || 'your follow-up'}. We want to help you complete the next step and make sure nothing important slips.”

Portal / text version:
“Your care team reviewed your ${record.measure || record.resultType || record.topic || 'next step'}. Please reply or schedule so we can keep your care moving.”

Staff note:
${bullets(a.recommendations)}`;
      case 'results_explainer':
        return `${commonHeader}
Patient-friendly explanation
----------------------------
Your ${record.resultType || 'test'} shows: ${record.resultSummary || 'results were reviewed by the team'}. In plain language, this likely means ${record.clinicalMeaning || 'your clinician wants to discuss what the result means in context'}. The next step is ${record.nextAction || 'follow-up with the office for the recommended plan'}.

Clinician layer
---------------
Keep the patient message calm, specific, and tied to the next action. Avoid dumping raw technical jargon unless the patient explicitly wants the nerd version.`;
      case 'care_plan':
        return `${commonHeader}
Longitudinal care plan draft
----------------------------
Primary goals:
${bullets((record.goals || 'Clarify measurable goals').split(/[,;]\s*/).slice(0,5))}

Known barriers:
${bullets((record.barriers || 'No barriers captured yet').split(/[,;]\s*/).slice(0,5))}

90-day direction:
${bullets([
  `Continue / refine current plan: ${record.currentPlan || 'plan details pending'}`,
  `Coordinate with care team: ${record.careTeam || 'care team not fully listed'}`,
  `Set review cadence around ${record.reviewDate || 'the next planned checkpoint'}`,
  ...a.recommendations.slice(0,2)
])}`;
      case 'surgical_checklist':
        return `${commonHeader}
Pre-op checklist draft
----------------------
Required items:
${bullets([
  record.clearanceNeeds || 'Clearances not fully listed',
  record.testingNeeded || 'Testing requirements not fully listed',
  record.medHolds || 'Medication hold guidance not fully listed',
  `Surgery target: ${record.surgeryDate || 'date not listed'}`
])}

Missing / risky items
---------------------
${bullets(a.missing.length ? a.missing : ['No major form gaps detected.'])}

Ops note
--------
If any critical clearance or med-hold instruction is uncertain, stop the parade and get explicit confirmation. Surgery paperwork is a chaos magnet.`;
      case 'quality_narrative':
        return `${commonHeader}
Quality-gap narrative
---------------------
This patient remains open for ${record.measure || 'the tracked quality measure'} because ${record.gapReason || 'the gap has not yet been closed'}. The most recent supporting evidence is ${record.lastEvidence || 'limited or stale evidence in the record'}. Recommended owner: ${record.owner || 'unassigned'}. The closure target is ${record.targetDate || 'not specified'}.

Huddle note
-----------
Focus the next touch on one concrete closure action, confirm the owner, and avoid letting the measure become decorative dashboard wallpaper.`;
      default:
        return `${commonHeader}\nNo generator configured.`;
    }
  }
  function mount(config){
    const root = document.getElementById('app-root');
    root.innerHTML = `
      <section class="hero">
        <span class="kicker">Doctor Ops AI Wave III</span>
        <h1>${escapeHtml(config.title)}</h1>
        <p>${escapeHtml(config.tagline)}</p>
      </section>
      <div class="grid grid-2">
        <section class="card">
          <h2>${escapeHtml(config.title)} Workbench</h2>
          <p>This is a static, local-first doctor ops surface with an embedded browser-side AI drafting layer. Use synthetic data only and require clinician review before real-world use.</p>
          <form id="record-form" class="form-grid">${buildForm(config.fields)}</form>
          <div class="action-row" style="margin-top:14px">
            <button id="save-btn" class="success" type="button">Save Record</button>
            <button id="reset-btn" class="secondary" type="button">Clear Form</button>
            <button id="export-json-btn" class="secondary" type="button">Export JSON</button>
            <button id="export-csv-btn" class="secondary" type="button">Export CSV</button>
            <label class="button secondary" for="import-json-input">Import JSON</label>
            <input id="import-json-input" type="file" accept="application/json" style="display:none" />
          </div>
          <small class="helper">Every record persists to local browser storage and appends to the audit log.</small>
        </section>
        <aside class="card">
          <h2>Queue Summary</h2>
          <div class="summary" id="summary-box"></div>
          <hr class="sep" />
          <div class="notice">AI here means an embedded drafting and triage layer running in the browser. It generates structure, risk flags, outreach drafts, summaries, and action plans from the record content. No cloud API required.</div>
        </aside>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="filters">
          <div class="field"><label for="search-input">Search</label><input id="search-input" type="text" placeholder="Search records..." /></div>
          <div class="field"><label for="status-filter">Status Filter</label><select id="status-filter"><option value="">All statuses</option>${(config.statusOptions||[]).map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div>
          <div class="field"><label for="priority-filter">Priority Filter</label><select id="priority-filter"><option value="">All priorities</option>${(config.priorityOptions||[]).map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div>
        </div>
        <div class="stat-row" style="margin-top:16px">
          <div class="stat"><div class="label">Total</div><div class="value" id="stat-total">0</div></div>
          <div class="stat"><div class="label">High / Urgent</div><div class="value" id="stat-high">0</div></div>
          <div class="stat"><div class="label">Due Soon</div><div class="value" id="stat-due">0</div></div>
          <div class="stat"><div class="label">Overdue</div><div class="value" id="stat-overdue">0</div></div>
        </div>
      </section>
      <section class="card" style="margin-top:16px">
        <h2>AI Copilot</h2>
        <div class="ai-meta-grid">
          <div class="stat"><div class="label">Active record</div><div class="value" id="ai-subject" style="font-size:18px">None selected</div></div>
          <div class="stat"><div class="label">AI urgency</div><div class="value" id="ai-urgency" style="font-size:18px">—</div></div>
          <div class="stat"><div class="label">Timeline</div><div class="value" id="ai-timeline" style="font-size:18px">—</div></div>
        </div>
        <div class="action-row" style="margin-bottom:10px">
          <button id="use-form-btn" class="secondary" type="button">Use Current Form</button>
          <button id="generate-all-btn" class="warn" type="button">Generate Full Pack</button>
          <button id="copy-ai-btn" class="secondary" type="button">Copy Output</button>
          <button id="download-ai-btn" class="secondary" type="button">Download TXT</button>
        </div>
        <div class="ai-toolbar">${config.aiActions.map(action => `<button class="secondary ai-action-btn" type="button" data-kind="${escapeHtml(action[0])}">${escapeHtml(action[1])}</button>`).join('')}</div>
        <div class="helper" style="margin:10px 0 12px">Pick a record from the table with “Use for AI”, or generate from the current form. Outputs are structured drafts, not autonomous clinical judgment. The goblin lawyer insists on that sentence.</div>
        <div id="ai-flags" class="action-row" style="margin-bottom:12px"></div>
        <div class="ai-output" id="ai-output">Choose a record or use the current form, then press an AI action.</div>
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
      <footer>Synthetic demo only. Static offline browser runtime. Require clinician review before any real-world medical use.</footer>
    `;
    const stateKey = config.storageKey;
    const state = readState(stateKey, config.seedRecords);
    let editingId = null;
    let activeRecordId = state.records[0]?.id || null;

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
    const aiOutput = document.getElementById('ai-output');
    const aiSubject = document.getElementById('ai-subject');
    const aiUrgency = document.getElementById('ai-urgency');
    const aiTimeline = document.getElementById('ai-timeline');
    const aiFlags = document.getElementById('ai-flags');

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
    function renderAI(record){
      if(!record){
        aiSubject.textContent = 'None selected';
        aiUrgency.textContent = '—';
        aiTimeline.textContent = '—';
        aiFlags.innerHTML = '';
        return;
      }
      const a = analyzeRecord(record, config);
      aiSubject.textContent = a.subject;
      aiUrgency.textContent = a.urgency.toUpperCase();
      aiTimeline.textContent = a.dueState;
      const pillItems = [a.urgency, ...(a.flags.slice(0,4))];
      aiFlags.innerHTML = pillItems.length ? pillItems.map(flag => `<span class="ai-pill">${escapeHtml(flag)}</span>`).join('') : '<span class="ai-pill">No major flags detected</span>';
    }
    function render(){
      const rows = filteredRecords();
      recordsBody.innerHTML = rows.length ? rows.map(record => {
        const cells = config.columns.map(name => {
          const field = config.fields.find(f => f.name === name) || {name};
          const value = record[name];
          const badgeable = (name === config.statusField || name === config.priorityField);
          const cls = badgeable ? `badge ${name===config.statusField?'status':'priority'}-${slugify(value)}` : '';
          const cell = badgeable ? `<span class="${cls}">${escapeHtml(fmt(value, field))}</span>` : escapeHtml(fmt(value, field));
          return `<td>${cell}</td>`;
        }).join('');
        return `<tr data-row-id="${record.id}">${cells}<td><div class="action-row"><button class="mini secondary" data-action="ai" data-id="${record.id}">Use for AI</button><button class="mini" data-action="edit" data-id="${record.id}">Edit</button><button class="mini secondary" data-action="clone" data-id="${record.id}">Clone</button><button class="mini danger" data-action="delete" data-id="${record.id}">Delete</button></div></td></tr>`;
      }).join('') : `<tr><td colspan="${config.columns.length + 1}"><div class="empty">No records match the current filters.</div></td></tr>`;
      const due = dueMetrics(state.records, config);
      const highCount = state.records.filter(r => ['high','urgent','critical'].includes(String(r[config.priorityField] || '').toLowerCase())).length;
      document.getElementById('stat-total').textContent = state.records.length;
      document.getElementById('stat-high').textContent = highCount;
      document.getElementById('stat-due').textContent = due.dueSoon;
      document.getElementById('stat-overdue').textContent = due.overdue;
      summaryBox.textContent = summarizeRecords(state.records, config);
      auditLog.innerHTML = state.audit.length ? state.audit.map(item => `<div class="log-item"><strong>${escapeHtml(item.action)}</strong><div class="meta">${escapeHtml(new Date(item.at).toLocaleString())}</div><div style="margin-top:6px">${escapeHtml(item.detail)}</div></div>`).join('') : `<div class="empty">No audit events yet.</div>`;
      const current = chooseRecord(state, activeRecordId);
      if(current) activeRecordId = current.id;
      renderAI(current);
      saveState(stateKey, state);
    }

    function runAI(kind, sourceRecord, via){
      if(!sourceRecord){ alert('No record selected for AI.'); return; }
      const text = buildAIOutput(kind, sourceRecord, config, state);
      aiOutput.textContent = text;
      addAudit(state, 'AI draft generated', `${kind} output generated for ${recordLabel(sourceRecord)} via ${via}.`);
      render();
    }

    saveBtn.addEventListener('click', () => {
      const data = getFormRecord();
      const name = data.patientName || data.chiefConcern || data.topic || config.entity;
      if(editingId){
        const idx = state.records.findIndex(r => r.id === editingId);
        if(idx >= 0){
          state.records[idx] = {...state.records[idx], ...data, updatedAt:new Date().toISOString()};
          activeRecordId = editingId;
          addAudit(state, 'Record updated', `${name} updated in ${config.title}.`);
        }
      } else {
        const rec = {...data, id: crypto.randomUUID(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
        state.records.unshift(rec);
        activeRecordId = rec.id;
        addAudit(state, 'Record created', `${name} created in ${config.title}.`);
      }
      resetForm();
      render();
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
          if(Array.isArray(parsed.audit)) state.audit = parsed.audit.concat(state.audit).slice(0,400);
          activeRecordId = state.records[0]?.id || null;
          addAudit(state, 'JSON imported', `${file.name} imported into ${config.title}.`);
          resetForm(); render();
        } else { alert('JSON file must contain a records array.'); }
      } catch(err){ alert('Unable to import JSON: ' + err.message); }
      event.target.value = '';
    });
    [searchInput, statusFilter, priorityFilter].forEach(el => el.addEventListener('input', render));
    [statusFilter, priorityFilter].forEach(el => el.addEventListener('change', render));

    recordsBody.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if(!button) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      const record = state.records.find(r => r.id === id); if(!record) return;
      if(action === 'ai'){
        activeRecordId = record.id;
        aiOutput.textContent = `Active record loaded: ${recordLabel(record)}\nChoose an AI action above to generate a draft.`;
        addAudit(state, 'AI record selected', `${recordLabel(record)} selected for AI in ${config.title}.`);
        render();
      } else if(action === 'edit'){
        populateForm(record);
      } else if(action === 'clone'){
        const copy = {...record, id: crypto.randomUUID(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
        state.records.unshift(copy);
        activeRecordId = copy.id;
        addAudit(state, 'Record cloned', `${recordLabel(record)} cloned in ${config.title}.`);
        render();
      } else if(action === 'delete'){
        if(confirm(`Delete this ${config.entity}?`)){
          state.records = state.records.filter(r => r.id !== id);
          if(editingId === id) resetForm();
          if(activeRecordId === id) activeRecordId = state.records[0]?.id || null;
          addAudit(state, 'Record deleted', `${recordLabel(record)} deleted from ${config.title}.`);
          render();
        }
      }
    });

    document.querySelectorAll('.ai-action-btn').forEach(btn => btn.addEventListener('click', () => {
      const record = chooseRecord(state, activeRecordId);
      runAI(btn.dataset.kind, record, 'selected record');
    }));
    document.getElementById('use-form-btn').addEventListener('click', () => {
      const formRecord = getFormRecord();
      if(!Object.values(formRecord).some(Boolean)){ alert('Form is empty. Fill fields or select an existing record.'); return; }
      activeRecordId = null;
      renderAI(formRecord);
      aiOutput.textContent = `Current form loaded into AI context.\nChoose an AI action to generate output from unsaved form data.`;
      window.__doctor_ai_form_record = formRecord;
      addAudit(state, 'AI form context loaded', `${config.title} current form loaded into AI context.`);
      render();
    });
    document.getElementById('generate-all-btn').addEventListener('click', () => {
      const record = window.__doctor_ai_form_record && !activeRecordId ? window.__doctor_ai_form_record : chooseRecord(state, activeRecordId);
      if(!record){ alert('No record available for AI.'); return; }
      const outputs = config.aiActions.map(([kind,label]) => `${label}\n${'='.repeat(label.length)}\n${buildAIOutput(kind, record, config, state)}`).join('\n\n');
      aiOutput.textContent = outputs;
      addAudit(state, 'AI full pack generated', `Full AI pack generated for ${recordLabel(record)} in ${config.title}.`);
      render();
    });
    document.getElementById('copy-ai-btn').addEventListener('click', async () => {
      try{ await navigator.clipboard.writeText(aiOutput.textContent); addAudit(state, 'AI output copied', `${config.title} AI output copied to clipboard.`); render(); }
      catch(err){ alert('Clipboard copy failed.'); }
    });
    document.getElementById('download-ai-btn').addEventListener('click', () => {
      download(`${config.slug}-ai-output.txt`, aiOutput.textContent, 'text/plain');
      addAudit(state, 'AI output downloaded', `${config.title} AI output downloaded as TXT.`);
      render();
    });

    if(!state.audit.length && state.records.length) addAudit(state, 'Seed loaded', `${state.records.length} synthetic record(s) loaded into ${config.title}.`);
    render();
  }
  return { mount };
})();
