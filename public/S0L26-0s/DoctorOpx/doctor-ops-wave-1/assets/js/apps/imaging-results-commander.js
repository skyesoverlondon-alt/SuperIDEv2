window.DOCTOR_OPS.createApp({
  id:"imaging-results-commander",
  title:"Imaging Results Commander",
  subtitle:"Radiology result lane with urgent findings and patient communication tracking.",
  blurb:"Track modality, result, urgency, communication, and follow-up recommendations.",
  recordLabel:"imaging result",
  previewTitle:"Generated imaging result brief",
  emptyCopy:"No imaging results yet.",
  statusField:"status",
  priorityField:"priority",
  defaultValues:{"status": "ordered", "priority": "routine", "communicatedToPatient": "no"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "modality", "label": "Modality", "type": "select", "options": ["X-ray", "CT", "MRI", "Ultrasound", "Mammogram", "Other"]}, {"name": "bodyRegion", "label": "Body region", "type": "text"}, {"name": "orderedDate", "label": "Ordered date", "type": "date"}, {"name": "resultDate", "label": "Result date", "type": "date"}, {"name": "priority", "label": "Priority", "type": "select", "options": ["routine", "urgent"]}, {"name": "impression", "label": "Impression", "type": "textarea", "rows": 5, "full": true}, {"name": "recommendedFollowup", "label": "Recommended follow-up", "type": "textarea", "rows": 4, "full": true}, {"name": "communicatedToPatient", "label": "Communicated to patient", "type": "select", "options": ["no", "yes"]}, {"name": "responsibleProvider", "label": "Responsible provider", "type": "text"}, {"name": "status", "label": "Status", "type": "select", "options": ["ordered", "resulted", "provider-review", "patient-contact", "follow-up-booked", "closed"]}, {"name": "notes", "label": "Notes", "type": "textarea", "rows": 4, "full": true}],
  statusOptions:["ordered", "resulted", "provider-review", "patient-contact", "follow-up-booked", "closed"],
  priorityOptions:["routine", "urgent"],
  detailKeys:["patientName", "modality", "bodyRegion", "orderedDate", "resultDate", "priority", "responsibleProvider", "communicatedToPatient", "status"],
  sampleRecords:[{"patientName": "Blake Hunter", "modality": "CT", "bodyRegion": "Chest", "orderedDate": "2026-03-15", "resultDate": "2026-03-16", "priority": "urgent", "impression": "Incidental pulmonary nodule; provider review needed.", "recommendedFollowup": "Discuss interval imaging recommendation.", "communicatedToPatient": "no", "responsibleProvider": "Dr. Vega Stone", "status": "provider-review", "notes": "Needs patient outreach."}],
  columns:[{key:"patientName"},{get:(rec)=> `${rec.modality} ${rec.bodyRegion || ""}`.trim()},{key:"priority",badge:true},{key:"status",badge:true},{key:"resultDate",type:"date"},{get:(rec)=> rec.contactState}],
  compute:(rec) => { rec.contactState = rec.communicatedToPatient==='yes' ? 'patient informed' : 'patient not yet informed'; rec.followNeeded = /follow|repeat|referral|interval/i.test(String(rec.recommendedFollowup || '')); return rec; },
  metrics:(records) => { const urgent=records.filter(r=>r.priority==='urgent').length; const uninformed=records.filter(r=>r.communicatedToPatient!=='yes').length; const follow=records.filter(r=>r.followNeeded).length; const closed=records.filter(r=>r.status==='closed').length; return [{label:'Total imaging items',value:records.length,subtext:'Results pipeline',tone:'info'},{label:'Urgent studies',value:urgent,subtext:'Faster attention lane',tone:urgent?'danger':'ok'},{label:'Patient not informed',value:uninformed,subtext:'Communication still open',tone:uninformed?'warn':'ok'},{label:'Follow-up recommended',value:follow,subtext:'Needs routing after review',tone:follow?'warn':'ok'},{label:'Closed',value:closed,subtext:'Loop resolved',tone:'ok'}]; },
  preview:(rec, h) => `IMAGING RESULT BRIEF

Patient: ${rec.patientName || '—'}
Study: ${rec.modality || '—'} ${rec.bodyRegion || ''}
Ordered: ${h.formatDate(rec.orderedDate)}
Resulted: ${h.formatDate(rec.resultDate)}
Priority: ${rec.priority || '—'}
Responsible provider: ${rec.responsibleProvider || '—'}
Status: ${rec.status || '—'}
Patient informed: ${rec.communicatedToPatient || '—'}

Impression
${rec.impression || '—'}

Recommended follow-up
${rec.recommendedFollowup || '—'}

Notes
${rec.notes || '—'}

Contact state: ${rec.contactState || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.modality || 'Imaging'}`,
  sortRecords:(rows) => rows.sort((a,b)=> (b.priority==='urgent') - (a.priority==='urgent') || String(b.resultDate||'').localeCompare(String(a.resultDate||'')))
});
