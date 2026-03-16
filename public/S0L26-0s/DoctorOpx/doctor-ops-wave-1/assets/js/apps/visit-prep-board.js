window.DOCTOR_OPS.createApp({
  id:"visit-prep-board",
  title:"Visit Prep Board",
  subtitle:"Pre-visit readiness cockpit with checklists, agenda, and missing records tracking.",
  blurb:"Track whether records, forms, labs, rooming tasks, and provider agenda items are actually ready.",
  recordLabel:"visit prep record",
  previewTitle:"Generated visit prep packet",
  emptyCopy:"No visit prep records yet.",
  defaultValues:{"status": "not-started", "visitType": "follow-up"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "appointmentDate", "label": "Appointment date", "type": "date"}, {"name": "visitType", "label": "Visit type", "type": "select", "options": ["follow-up", "new patient", "annual", "procedure follow-up", "telehealth"]}, {"name": "agenda", "label": "Visit agenda", "type": "textarea", "rows": 4, "full": true}, {"name": "recordsNeeded", "label": "Records needed", "type": "textarea", "rows": 4, "full": true}, {"name": "labsNeeded", "label": "Labs / diagnostics needed", "type": "textarea", "rows": 4, "full": true}, {"name": "formsNeeded", "label": "Forms needed", "type": "textarea", "rows": 4, "full": true}, {"name": "medsToReview", "label": "Meds to review", "type": "textarea", "rows": 4, "full": true}, {"name": "roomingChecklist", "label": "Rooming checklist", "type": "textarea", "rows": 4, "full": true, "help": "One item per line. Prefix completed items with [x]."}, {"name": "providerPrep", "label": "Provider prep notes", "type": "textarea", "rows": 4, "full": true}, {"name": "status", "label": "Status", "type": "select", "options": ["not-started", "in-prep", "ready", "completed"]}],
  statusOptions:["not-started", "in-prep", "ready", "completed"],
  priorityOptions:[],
  detailKeys:["patientName", "appointmentDate", "visitType", "status", "readinessLabel", "openItemsLabel"],
  sampleRecords:[{"patientName": "Emerson Tate", "appointmentDate": "2026-03-18", "visitType": "new patient", "agenda": "Establish care, review outside records, address hypertension history.", "recordsNeeded": "Outside PCP records\\nRecent urgent care note", "labsNeeded": "CMP\\nLipid panel", "formsNeeded": "ROI\\nNew patient packet", "medsToReview": "Lisinopril\\nHydrochlorothiazide", "roomingChecklist": "[x] Verify demographics\\n[ ] Complete PHQ-2\\n[ ] Reconcile meds", "providerPrep": "Need outside notes before final plan.", "status": "in-prep"}],
  columns:[{key:"patientName"},{key:"visitType"},{key:"status",badge:true},{key:"appointmentDate",type:"date"},{get:(rec)=> rec.readinessLabel},{get:(rec)=> rec.openItemsLabel}],
  compute:(rec) => { const items=String(rec.roomingChecklist || '').split(/\n+/).map(s=>s.trim()).filter(Boolean); const done=items.filter(i=>/^\[x\]/i.test(i)).length; const total=items.length; const readiness=total?Math.round((done/total)*100):0; rec.readiness=readiness; rec.readinessLabel=`${readiness}% ready`; rec.openItemsLabel=`${Math.max(total-done,0)} open checklist items`; return rec; },
  metrics:(records) => { const ready=records.filter(r=>['ready','completed'].includes(r.status)).length; const avg=records.length?Math.round(records.reduce((n,r)=>n+(r.readiness||0),0)/records.length):0; const notReady=records.filter(r=>(r.readiness||0)<100).length; return [{label:'Visit prep items',value:records.length,subtext:'Upcoming encounters',tone:'info'},{label:'Average readiness',value:`${avg}%`,subtext:'Across checklist items',tone:'info'},{label:'Not fully ready',value:notReady,subtext:'Open tasks remain',tone:notReady?'warn':'ok'},{label:'Ready / completed',value:ready,subtext:'Good civilized order',tone:'ok'}]; },
  preview:(rec, h) => `VISIT PREP PACKET

Patient: ${rec.patientName || '—'}
Appointment date: ${h.formatDate(rec.appointmentDate)}
Visit type: ${rec.visitType || '—'}
Status: ${rec.status || '—'}
Readiness: ${rec.readinessLabel || '—'}

Agenda
${rec.agenda || '—'}

Records needed
${rec.recordsNeeded || '—'}

Labs / diagnostics needed
${rec.labsNeeded || '—'}

Forms needed
${rec.formsNeeded || '—'}

Meds to review
${rec.medsToReview || '—'}

Rooming checklist
${rec.roomingChecklist || '—'}

Provider prep notes
${rec.providerPrep || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.visitType || 'Visit'}`,
  sortRecords:(rows) => rows.sort((a,b)=> String(a.appointmentDate||'9999').localeCompare(String(b.appointmentDate||'9999')))
});
