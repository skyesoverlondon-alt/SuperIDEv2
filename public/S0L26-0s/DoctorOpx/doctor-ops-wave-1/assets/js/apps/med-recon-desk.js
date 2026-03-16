window.DOCTOR_OPS.createApp({
  id:"med-recon-desk",
  title:"Medication Reconciliation Desk",
  subtitle:"Medication truth machine for adds, stops, and dosing changes.",
  blurb:"Compare medication lists from different sources, record what changed, and generate a reconciliation summary.",
  recordLabel:"med reconciliation",
  previewTitle:"Generated med reconciliation summary",
  emptyCopy:"No med reconciliation records yet.",
  defaultValues:{"status": "draft"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "encounterDate", "label": "Encounter date", "type": "date"}, {"name": "sourceEncounter", "label": "Source encounter / list source", "type": "text", "full": true}, {"name": "currentMeds", "label": "Current med list", "type": "textarea", "rows": 5, "full": true}, {"name": "outsideMeds", "label": "Outside / incoming med list", "type": "textarea", "rows": 5, "full": true}, {"name": "addedMeds", "label": "Adds", "type": "textarea", "rows": 4, "full": true}, {"name": "stoppedMeds", "label": "Stops", "type": "textarea", "rows": 4, "full": true}, {"name": "changedMeds", "label": "Dose / frequency changes", "type": "textarea", "rows": 4, "full": true}, {"name": "allergies", "label": "Allergies", "type": "text", "full": true}, {"name": "pharmacistReview", "label": "Pharmacist / reviewer notes", "type": "textarea", "rows": 4, "full": true}, {"name": "status", "label": "Status", "type": "select", "options": ["draft", "pharmacist-review", "provider-review", "final"]}],
  statusOptions:["draft", "pharmacist-review", "provider-review", "final"],
  priorityOptions:[],
  detailKeys:["patientName", "encounterDate", "sourceEncounter", "allergies", "status", "changeCountLabel", "riskFlag"],
  sampleRecords:[{"patientName": "Harper Cole", "encounterDate": "2026-03-15", "sourceEncounter": "Hospital discharge med list", "currentMeds": "Metformin 500 mg BID\\nLisinopril 10 mg daily", "outsideMeds": "Metformin 500 mg BID\\nLisinopril 20 mg daily\\nAtorvastatin 20 mg nightly", "addedMeds": "Atorvastatin 20 mg nightly", "stoppedMeds": "", "changedMeds": "Lisinopril increased from 10 mg to 20 mg daily", "allergies": "Sulfa", "pharmacistReview": "Dose change verified in discharge summary.", "status": "provider-review"}],
  columns:[{key:"patientName"},{key:"sourceEncounter"},{get:(rec)=> rec.changeCountLabel},{key:"status",badge:true},{key:"encounterDate",type:"date"},{get:(rec)=> rec.riskFlag}],
  compute:(rec) => { const parts=['addedMeds','stoppedMeds','changedMeds'].map(k=>String(rec[k]||'').split(/\n+/).map(s=>s.trim()).filter(Boolean).length); rec.changeCount=parts.reduce((a,b)=>a+b,0); rec.changeCountLabel=`${rec.changeCount} documented changes`; rec.riskFlag=/warfarin|insulin|opioid|anticoagulant/i.test(`${rec.currentMeds}\n${rec.outsideMeds}`)?'high-risk meds present':'standard-risk list'; return rec; },
  metrics:(records) => { const finals=records.filter(r=>r.status==='final').length; const review=records.filter(r=>['pharmacist-review','provider-review'].includes(r.status)).length; const high=records.filter(r=>/high-risk/.test(String(r.riskFlag))).length; const changes=records.reduce((n,r)=>n+(r.changeCount||0),0); return [{label:'Total reconciliations',value:records.length,subtext:'Synthetic med lanes',tone:'info'},{label:'Changes documented',value:changes,subtext:'Adds/stops/edits',tone:'info'},{label:'In review',value:review,subtext:'Needs signoff',tone:review?'warn':'ok'},{label:'Finalized',value:finals,subtext:'Closed med truth pass',tone:'ok'},{label:'High-risk med lists',value:high,subtext:'Insulin / anticoagulant / opioid watch',tone:high?'danger':'ok'}]; },
  preview:(rec, h) => `MEDICATION RECONCILIATION SUMMARY

Patient: ${rec.patientName || '—'}
Encounter date: ${h.formatDate(rec.encounterDate)}
Source encounter: ${rec.sourceEncounter || '—'}
Status: ${rec.status || '—'}
Allergies: ${rec.allergies || '—'}
Risk flag: ${rec.riskFlag || '—'}

Current med list
${rec.currentMeds || '—'}

Incoming / outside med list
${rec.outsideMeds || '—'}

Adds
${rec.addedMeds || '—'}

Stops
${rec.stoppedMeds || '—'}

Dose / frequency changes
${rec.changedMeds || '—'}

Reviewer notes
${rec.pharmacistReview || '—'}

Change count: ${rec.changeCountLabel || '0 changes'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — Med Rec`,
  sortRecords:(rows) => rows.sort((a,b)=> String(b.encounterDate||'').localeCompare(String(a.encounterDate||'')) || (b.changeCount||0)-(a.changeCount||0))
});
