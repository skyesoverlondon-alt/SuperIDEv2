window.DOCTOR_OPS.createApp({
  id:"chronic-care-tracker",
  title:"Chronic Care Tracker",
  subtitle:"Longitudinal condition board for targets, current metrics, barriers, and next actions.",
  blurb:"Track chronic care goals for panel management, coaching, and condition follow-up planning.",
  recordLabel:"chronic care case",
  previewTitle:"Generated chronic care summary",
  emptyCopy:"No chronic care cases yet.",
  defaultValues:{"status": "monitoring", "adherence": "mixed"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "program", "label": "Program", "type": "text"}, {"name": "condition", "label": "Condition", "type": "text"}, {"name": "targetMetric", "label": "Target metric", "type": "text"}, {"name": "currentMetric", "label": "Current metric", "type": "text"}, {"name": "lastVisit", "label": "Last visit", "type": "date"}, {"name": "nextVisit", "label": "Next visit", "type": "date"}, {"name": "adherence", "label": "Adherence", "type": "select", "options": ["good", "mixed", "poor"]}, {"name": "barriers", "label": "Barriers", "type": "textarea", "rows": 4, "full": true}, {"name": "actionPlan", "label": "Action plan", "type": "textarea", "rows": 4, "full": true}, {"name": "status", "label": "Status", "type": "select", "options": ["monitoring", "needs-adjustment", "scheduled", "stable", "closed"]}],
  statusOptions:["monitoring", "needs-adjustment", "scheduled", "stable", "closed"],
  priorityOptions:[],
  detailKeys:["patientName", "program", "condition", "targetMetric", "currentMetric", "lastVisit", "nextVisit", "adherence", "status"],
  sampleRecords:[{"patientName": "Phoenix Hale", "program": "Chronic Care", "condition": "Hypertension", "targetMetric": "BP < 130/80", "currentMetric": "138/86", "lastVisit": "2026-03-01", "nextVisit": "2026-03-29", "adherence": "mixed", "barriers": "Inconsistent evening dosing; high work stress.", "actionPlan": "Home BP log 3x/week, improve evening med routine, reassess in 4 weeks.", "status": "needs-adjustment"}],
  columns:[{key:"patientName"},{key:"condition"},{key:"adherence",badge:true},{key:"status",badge:true},{key:"nextVisit",type:"date"},{get:(rec)=> rec.followState}],
  compute:(rec, h) => { const d=h.daysBetween(rec.nextVisit); rec.followState=d===null?'no visit scheduled':d>0?`${d}d overdue`:d===0?'next visit today':`${Math.abs(d)}d until next visit`; rec.needsAttention = rec.status==='needs-adjustment' || rec.adherence==='poor'; return rec; },
  metrics:(records) => { const attention=records.filter(r=>r.needsAttention).length; const poor=records.filter(r=>r.adherence==='poor').length; const stable=records.filter(r=>r.status==='stable').length; return [{label:'Chronic care cases',value:records.length,subtext:'Synthetic longitudinal panel',tone:'info'},{label:'Needs adjustment',value:attention,subtext:'Status or adherence suggests intervention',tone:attention?'warn':'ok'},{label:'Poor adherence',value:poor,subtext:'Barrier-heavy cases',tone:poor?'danger':'ok'},{label:'Stable',value:stable,subtext:'Holding the line',tone:'ok'}]; },
  preview:(rec, h) => `CHRONIC CARE SUMMARY

Patient: ${rec.patientName || '—'}
Program: ${rec.program || '—'}
Condition: ${rec.condition || '—'}
Target metric: ${rec.targetMetric || '—'}
Current metric: ${rec.currentMetric || '—'}
Last visit: ${h.formatDate(rec.lastVisit)}
Next visit: ${h.formatDate(rec.nextVisit)}
Adherence: ${rec.adherence || '—'}
Status: ${rec.status || '—'}

Barriers
${rec.barriers || '—'}

Action plan
${rec.actionPlan || '—'}

Follow-state: ${rec.followState || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.condition || 'Condition'}`,
  sortRecords:(rows) => rows.sort((a,b)=> (b.needsAttention===true)-(a.needsAttention===true) || String(a.nextVisit||'9999').localeCompare(String(b.nextVisit||'9999')))
});
