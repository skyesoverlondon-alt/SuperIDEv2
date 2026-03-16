window.DOCTOR_OPS.createApp({
  id:"soap-note-studio",
  title:"SOAP Note Studio",
  subtitle:"Structured visit documentation with exportable note text.",
  blurb:"Draft and finalize SOAP notes, track coding level, follow-up timing, and section completeness.",
  recordLabel:"soap note",
  previewTitle:"Generated SOAP note",
  emptyCopy:"No SOAP notes yet.",
  defaultValues:{"status": "draft", "billingLevel": "99213"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "visitDate", "label": "Visit date", "type": "date"}, {"name": "provider", "label": "Provider", "type": "text"}, {"name": "visitType", "label": "Visit type", "type": "select", "options": ["follow-up", "new patient", "annual", "urgent visit", "telehealth"]}, {"name": "subjective", "label": "Subjective", "type": "textarea", "rows": 6, "full": true}, {"name": "objective", "label": "Objective", "type": "textarea", "rows": 6, "full": true}, {"name": "assessment", "label": "Assessment", "type": "textarea", "rows": 5, "full": true}, {"name": "plan", "label": "Plan", "type": "textarea", "rows": 6, "full": true}, {"name": "dxCodes", "label": "Dx / problem list", "type": "text", "full": true}, {"name": "billingLevel", "label": "Billing level", "type": "select", "options": ["99212", "99213", "99214", "99215"]}, {"name": "followup", "label": "Follow-up plan", "type": "text", "full": true}, {"name": "status", "label": "Status", "type": "select", "options": ["draft", "ready-for-review", "final"]}],
  statusOptions:["draft", "ready-for-review", "final"],
  priorityOptions:[],
  detailKeys:["patientName", "visitDate", "provider", "visitType", "billingLevel", "status", "followup", "dxCodes"],
  sampleRecords:[{"patientName": "Morgan Ellis", "visitDate": "2026-03-14", "provider": "Dr. Luna Hart", "visitType": "follow-up", "subjective": "Patient reports improved fasting glucose after tighter diet adherence. Mild fatigue persists.", "objective": "BP 128/80. Weight down 3 lb from prior. No acute distress.", "assessment": "Type 2 diabetes with improving self-management. Fatigue likely multifactorial.", "plan": "Continue current metformin dose. Order repeat A1c in 8 weeks. Reinforce hydration, sleep, and nutrition targets.", "dxCodes": "Type 2 diabetes; fatigue", "billingLevel": "99214", "followup": "Return in 8 weeks with fasting labs.", "status": "ready-for-review"}],
  columns:[{key:"patientName"},{key:"visitType"},{key:"provider"},{key:"billingLevel",badge:true},{key:"status",badge:true},{get:(rec)=> rec.completeness}],
  compute:(rec) => { const keys=['subjective','objective','assessment','plan']; const filled=keys.filter(k=>String(rec[k]||'').trim()).length; rec.completeness=`${filled}/4 sections`; rec.noteWordCount=keys.reduce((n,k)=>n+String(rec[k]||'').trim().split(/\s+/).filter(Boolean).length,0); return rec; },
  metrics:(records) => { const drafts=records.filter(r=>r.status==='draft').length; const review=records.filter(r=>r.status==='ready-for-review').length; const final=records.filter(r=>r.status==='final').length; const avg=records.length?Math.round(records.reduce((n,r)=>n+(r.noteWordCount||0),0)/records.length):0; return [{label:'Total notes',value:records.length,subtext:'Structured visit records',tone:'info'},{label:'Drafts',value:drafts,subtext:'Still being worked',tone:drafts?'warn':'ok'},{label:'Ready for review',value:review,subtext:'Needs clinician eyes',tone:review?'warn':'ok'},{label:'Finalized',value:final,subtext:'Closed documentation',tone:'ok'},{label:'Avg word count',value:avg,subtext:'Across SOAP sections',tone:'info'}]; },
  preview:(rec, h) => `SOAP NOTE

Patient: ${rec.patientName || '—'}
Visit date: ${h.formatDate(rec.visitDate)}
Provider: ${rec.provider || '—'}
Visit type: ${rec.visitType || '—'}
Billing level: ${rec.billingLevel || '—'}
Dx / problems: ${rec.dxCodes || '—'}

S — Subjective
${rec.subjective || '—'}

O — Objective
${rec.objective || '—'}

A — Assessment
${rec.assessment || '—'}

P — Plan
${rec.plan || '—'}

Follow-up: ${rec.followup || '—'}
Status: ${rec.status || '—'}
Completeness: ${rec.completeness}
Word count: ${rec.noteWordCount || 0}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.visitType || 'Visit'}`,
  sortRecords:(rows) => rows.sort((a,b)=> String(b.visitDate||'').localeCompare(String(a.visitDate||'')) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
});
