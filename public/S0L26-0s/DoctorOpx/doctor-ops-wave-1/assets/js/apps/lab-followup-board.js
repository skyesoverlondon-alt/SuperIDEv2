window.DOCTOR_OPS.createApp({
  id:"lab-followup-board",
  title:"Lab Follow-up Board",
  subtitle:"Result closure board for normal, borderline, and critical labs.",
  blurb:"Track whether results came back, whether they were communicated, and whether clinical next steps are actually assigned.",
  recordLabel:"lab follow-up",
  previewTitle:"Generated lab follow-up plan",
  emptyCopy:"No lab follow-up items yet.",
  statusField:"status",
  priorityField:"resultClass",
  defaultValues:{"status": "pending-result", "resultClass": "normal", "patientContacted": "no"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "testName", "label": "Test name", "type": "text"}, {"name": "collectedDate", "label": "Collected date", "type": "date"}, {"name": "resultDate", "label": "Result date", "type": "date"}, {"name": "resultClass", "label": "Result class", "type": "select", "options": ["normal", "borderline", "critical"]}, {"name": "resultSummary", "label": "Result summary", "type": "textarea", "rows": 4, "full": true}, {"name": "providerAction", "label": "Provider action", "type": "textarea", "rows": 4, "full": true}, {"name": "patientContacted", "label": "Patient contacted", "type": "select", "options": ["no", "yes"]}, {"name": "followupBy", "label": "Follow-up by date", "type": "date"}, {"name": "status", "label": "Status", "type": "select", "options": ["pending-result", "needs-review", "contact-patient", "follow-up-booked", "closed"]}, {"name": "notes", "label": "Follow-up notes", "type": "textarea", "rows": 5, "full": true}],
  statusOptions:["pending-result", "needs-review", "contact-patient", "follow-up-booked", "closed"],
  priorityOptions:["normal", "borderline", "critical"],
  detailKeys:["patientName", "testName", "collectedDate", "resultDate", "resultClass", "status", "patientContacted", "followupBy"],
  sampleRecords:[{"patientName": "Drew Winters", "testName": "Potassium", "collectedDate": "2026-03-15", "resultDate": "2026-03-15", "resultClass": "critical", "resultSummary": "Potassium elevated beyond clinic threshold.", "providerAction": "Immediate provider review and patient contact.", "patientContacted": "no", "followupBy": "2026-03-16", "status": "contact-patient", "notes": "Escalation required."}],
  columns:[{key:"patientName"},{key:"testName"},{key:"resultClass",badge:true},{key:"status",badge:true},{key:"followupBy",type:"date"},{get:(rec)=> rec.followState}],
  compute:(rec, h) => { const d=h.daysBetween(rec.followupBy); if(['closed','follow-up-booked'].includes(rec.status)) rec.followState='scheduled/closed'; else if(d!==null && d>0) rec.followState=`${d}d overdue`; else if(d===0) rec.followState='due today'; else if(d!==null) rec.followState=`${Math.abs(d)}d left`; else rec.followState='no target'; rec.isCriticalUncontacted = rec.resultClass==='critical' && rec.patientContacted!=='yes'; return rec; },
  metrics:(records) => { const critical=records.filter(r=>r.resultClass==='critical').length; const uncontacted=records.filter(r=>r.patientContacted!=='yes').length; const hot=records.filter(r=>r.isCriticalUncontacted).length; const closed=records.filter(r=>r.status==='closed').length; return [{label:'Total lab items',value:records.length,subtext:'Synthetic result queue',tone:'info'},{label:'Critical results',value:critical,subtext:'Need fast closure',tone:critical?'danger':'ok'},{label:'Uncontacted',value:uncontacted,subtext:'Patient not yet reached',tone:uncontacted?'warn':'ok'},{label:'Critical + uncontacted',value:hot,subtext:'Red flashing goblin',tone:hot?'danger':'ok'},{label:'Closed',value:closed,subtext:'Loop actually closed',tone:'ok'}]; },
  preview:(rec, h) => `LAB FOLLOW-UP PLAN

Patient: ${rec.patientName || '—'}
Test: ${rec.testName || '—'}
Collected: ${h.formatDate(rec.collectedDate)}
Result date: ${h.formatDate(rec.resultDate)}
Result class: ${rec.resultClass || '—'}
Status: ${rec.status || '—'}
Patient contacted: ${rec.patientContacted || '—'}
Follow-up by: ${h.formatDate(rec.followupBy)}

Result summary:
${rec.resultSummary || '—'}

Provider action:
${rec.providerAction || '—'}

Notes:
${rec.notes || '—'}

Queue state: ${rec.followState || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.testName || 'Lab'}`,
  sortRecords:(rows) => rows.sort((a,b)=>({critical:3,borderline:2,normal:1}[b.resultClass]||0)-({critical:3,borderline:2,normal:1}[a.resultClass]||0) || String(a.followupBy||'9999').localeCompare(String(b.followupBy||'9999')))
});
