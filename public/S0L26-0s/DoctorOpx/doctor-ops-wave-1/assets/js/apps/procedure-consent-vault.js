window.DOCTOR_OPS.createApp({
  id:"procedure-consent-vault",
  title:"Procedure Consent Vault",
  subtitle:"Consent packet integrity lane with witness, risks, benefits, and alternatives.",
  blurb:"Track whether the essential pieces of procedural consent were discussed and recorded.",
  recordLabel:"consent packet",
  previewTitle:"Generated consent brief",
  emptyCopy:"No consent packets yet.",
  defaultValues:{"status": "draft"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "procedureName", "label": "Procedure name", "type": "text", "full": true}, {"name": "surgeon", "label": "Surgeon / proceduralist", "type": "text"}, {"name": "consentVersion", "label": "Consent version", "type": "text"}, {"name": "risksDiscussed", "label": "Risks discussed", "type": "textarea", "rows": 4, "full": true}, {"name": "benefitsDiscussed", "label": "Benefits discussed", "type": "textarea", "rows": 4, "full": true}, {"name": "alternativesDiscussed", "label": "Alternatives discussed", "type": "textarea", "rows": 4, "full": true}, {"name": "witness", "label": "Witness", "type": "text"}, {"name": "signedDate", "label": "Signed date", "type": "date"}, {"name": "status", "label": "Status", "type": "select", "options": ["draft", "awaiting-signature", "signed", "ready-for-procedure", "archived"]}, {"name": "notes", "label": "Consent notes", "type": "textarea", "rows": 4, "full": true}],
  statusOptions:["draft", "awaiting-signature", "signed", "ready-for-procedure", "archived"],
  priorityOptions:[],
  detailKeys:["patientName", "procedureName", "surgeon", "consentVersion", "witness", "signedDate", "status", "completenessLabel"],
  sampleRecords:[{"patientName": "Dakota Reed", "procedureName": "Colonoscopy", "surgeon": "Dr. Mira Stone", "consentVersion": "v2026.1", "risksDiscussed": "Bleeding\\nPerforation\\nSedation risks", "benefitsDiscussed": "Diagnostic evaluation and early lesion detection.", "alternativesDiscussed": "Deferring procedure, stool-based screening options where appropriate.", "witness": "Ana P.", "signedDate": "2026-03-15", "status": "signed", "notes": "Packet complete pending procedure date."}],
  columns:[{key:"patientName"},{key:"procedureName"},{key:"surgeon"},{key:"status",badge:true},{key:"signedDate",type:"date"},{get:(rec)=> rec.completenessLabel}],
  compute:(rec) => { const n=['risksDiscussed','benefitsDiscussed','alternativesDiscussed','witness','signedDate'].filter(k=>String(rec[k]||'').trim()).length; rec.completenessLabel=`${n}/5 core elements present`; return rec; },
  metrics:(records) => { const signed=records.filter(r=>['signed','ready-for-procedure','archived'].includes(r.status)).length; const waiting=records.filter(r=>['draft','awaiting-signature'].includes(r.status)).length; const ready=records.filter(r=>r.status==='ready-for-procedure').length; return [{label:'Consent packets',value:records.length,subtext:'Synthetic procedural docs',tone:'info'},{label:'Awaiting completion',value:waiting,subtext:'Still needs packet work',tone:waiting?'warn':'ok'},{label:'Signed',value:signed,subtext:'Signature obtained',tone:'ok'},{label:'Ready for procedure',value:ready,subtext:'Operationally lined up',tone:'ok'}]; },
  preview:(rec, h) => `PROCEDURE CONSENT BRIEF

Patient: ${rec.patientName || '—'}
Procedure: ${rec.procedureName || '—'}
Proceduralist: ${rec.surgeon || '—'}
Consent version: ${rec.consentVersion || '—'}
Witness: ${rec.witness || '—'}
Signed date: ${h.formatDate(rec.signedDate)}
Status: ${rec.status || '—'}
Completeness: ${rec.completenessLabel || '—'}

Risks discussed
${rec.risksDiscussed || '—'}

Benefits discussed
${rec.benefitsDiscussed || '—'}

Alternatives discussed
${rec.alternativesDiscussed || '—'}

Notes
${rec.notes || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.procedureName || 'Consent'}`,
  sortRecords:(rows) => rows.sort((a,b)=> String(b.signedDate||'').localeCompare(String(a.signedDate||'')) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
});
