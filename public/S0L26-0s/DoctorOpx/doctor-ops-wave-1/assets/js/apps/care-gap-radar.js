window.DOCTOR_OPS.createApp({
  id:"care-gap-radar",
  title:"Care Gap Radar",
  subtitle:"Preventive and chronic outreach board with due dates and outreach attempts.",
  blurb:"A practical care-gap tracker for screenings, chronic metrics, and outreach sequences.",
  recordLabel:"care gap item",
  previewTitle:"Generated care gap plan",
  emptyCopy:"No care gap items yet.",
  statusField:"status",
  priorityField:"riskTier",
  defaultValues:{"status": "due", "riskTier": "medium"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "provider", "label": "Provider", "type": "text"}, {"name": "careProgram", "label": "Program / panel", "type": "text"}, {"name": "gapType", "label": "Gap type", "type": "text"}, {"name": "dueDate", "label": "Due date", "type": "date"}, {"name": "riskTier", "label": "Risk tier", "type": "select", "options": ["low", "medium", "high"]}, {"name": "outreach1", "label": "Outreach #1", "type": "date"}, {"name": "outreach2", "label": "Outreach #2", "type": "date"}, {"name": "outreach3", "label": "Outreach #3", "type": "date"}, {"name": "scheduledDate", "label": "Scheduled date", "type": "date"}, {"name": "status", "label": "Status", "type": "select", "options": ["due", "outreach-1", "outreach-2", "scheduled", "closed"]}, {"name": "notes", "label": "Outreach notes", "type": "textarea", "rows": 5, "full": true}],
  statusOptions:["due", "outreach-1", "outreach-2", "scheduled", "closed"],
  priorityOptions:["low", "medium", "high"],
  detailKeys:["patientName", "provider", "careProgram", "gapType", "dueDate", "riskTier", "scheduledDate", "status"],
  sampleRecords:[{"patientName": "Elliot Nash", "provider": "Dr. Sol Vega", "careProgram": "Diabetes Panel", "gapType": "A1c check", "dueDate": "2026-03-05", "riskTier": "high", "outreach1": "2026-03-06", "outreach2": "2026-03-10", "outreach3": "", "scheduledDate": "2026-03-20", "status": "scheduled", "notes": "Patient accepted morning slot."}],
  columns:[{key:"patientName"},{key:"gapType"},{key:"riskTier",badge:true},{key:"status",badge:true},{key:"dueDate",type:"date"},{get:(rec)=> rec.outreachStage}],
  compute:(rec, h) => { const d=h.daysBetween(rec.dueDate); rec.dueState=d===null?'no due date':d>0?`${d}d overdue`:d===0?'due today':`${Math.abs(d)}d until due`; const attempts=['outreach1','outreach2','outreach3'].filter(k=>rec[k]).length; rec.outreachStage=`${attempts} outreach touches`; return rec; },
  metrics:(records) => { const overdue=records.filter(r=>/overdue|due today/.test(String(r.dueState))).length; const high=records.filter(r=>r.riskTier==='high').length; const scheduled=records.filter(r=>r.status==='scheduled').length; const closed=records.filter(r=>r.status==='closed').length; return [{label:'Total care gaps',value:records.length,subtext:'Synthetic population queue',tone:'info'},{label:'Overdue / due today',value:overdue,subtext:'Needs outreach or booking',tone:overdue?'danger':'ok'},{label:'High-risk patients',value:high,subtext:'Prioritize thoughtfully',tone:high?'warn':'ok'},{label:'Scheduled',value:scheduled,subtext:'Moving toward closure',tone:'ok'},{label:'Closed',value:closed,subtext:'Gap resolved',tone:'ok'}]; },
  preview:(rec, h) => `CARE GAP PLAN

Patient: ${rec.patientName || '—'}
Provider: ${rec.provider || '—'}
Program: ${rec.careProgram || '—'}
Gap type: ${rec.gapType || '—'}
Due date: ${h.formatDate(rec.dueDate)}
Risk tier: ${rec.riskTier || '—'}
Status: ${rec.status || '—'}
Scheduled date: ${h.formatDate(rec.scheduledDate)}

Outreach sequence
- Touch 1: ${h.formatDate(rec.outreach1)}
- Touch 2: ${h.formatDate(rec.outreach2)}
- Touch 3: ${h.formatDate(rec.outreach3)}

Notes
${rec.notes || '—'}

Due-state: ${rec.dueState || '—'}
Outreach stage: ${rec.outreachStage || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.gapType || 'Gap'}`,
  sortRecords:(rows) => rows.sort((a,b)=> (b.riskTier==='high') - (a.riskTier==='high') || String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')))
});
