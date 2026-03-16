window.DOCTOR_OPS.createApp({
  id:"discharge-packet-builder",
  title:"Discharge Packet Builder",
  subtitle:"Aftercare packet generator for diagnosis, medication changes, precautions, and follow-up.",
  blurb:"Create a clean discharge summary packet with the operational pieces patients and staff actually need to reference later.",
  recordLabel:"discharge packet",
  previewTitle:"Generated discharge packet",
  emptyCopy:"No discharge packets yet.",
  defaultValues:{"status": "draft"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "encounterType", "label": "Encounter type", "type": "select", "options": ["office visit", "urgent visit", "ED follow-up", "hospital discharge", "procedure follow-up"]}, {"name": "dischargeDate", "label": "Discharge date", "type": "date"}, {"name": "diagnosis", "label": "Diagnosis / summary", "type": "textarea", "rows": 4, "full": true}, {"name": "medicationChanges", "label": "Medication changes", "type": "textarea", "rows": 4, "full": true}, {"name": "restrictions", "label": "Restrictions / activity guidance", "type": "textarea", "rows": 4, "full": true}, {"name": "returnPrecautions", "label": "Return precautions", "type": "textarea", "rows": 4, "full": true}, {"name": "followupAppointments", "label": "Follow-up appointments / next steps", "type": "textarea", "rows": 4, "full": true}, {"name": "packetStatus", "label": "Packet completeness notes", "type": "text", "full": true}, {"name": "status", "label": "Status", "type": "select", "options": ["draft", "ready-for-review", "ready-to-print", "closed"]}],
  statusOptions:["draft", "ready-for-review", "ready-to-print", "closed"],
  priorityOptions:[],
  detailKeys:["patientName", "encounterType", "dischargeDate", "status", "completenessLabel", "packetStatus"],
  sampleRecords:[{"patientName": "Micah Flynn", "encounterType": "hospital discharge", "dischargeDate": "2026-03-15", "diagnosis": "Pneumonia improved with inpatient treatment. Stable for home discharge.", "medicationChanges": "Complete oral antibiotic course.\\nResume home inhaler regimen.", "restrictions": "Avoid heavy exertion until stamina improves.", "returnPrecautions": "Return for worsening shortness of breath, chest pain, fever recurrence, or confusion.", "followupAppointments": "Primary care within 5-7 days. Pulmonary follow-up PRN.", "packetStatus": "Diagnosis, meds, precautions, follow-up all drafted.", "status": "ready-for-review"}],
  columns:[{key:"patientName"},{key:"encounterType"},{key:"status",badge:true},{key:"dischargeDate",type:"date"},{get:(rec)=> rec.completenessLabel},{get:(rec)=> rec.packetFlag}],
  compute:(rec) => { const n=['diagnosis','medicationChanges','restrictions','returnPrecautions','followupAppointments'].filter(k=>String(rec[k]||'').trim()).length; rec.completenessLabel=`${n}/5 discharge sections filled`; rec.packetFlag=n>=4?'strong packet':'packet thin'; return rec; },
  metrics:(records) => { const printable=records.filter(r=>['ready-to-print','closed'].includes(r.status)).length; const review=records.filter(r=>r.status==='ready-for-review').length; const thin=records.filter(r=>r.packetFlag==='packet thin').length; return [{label:'Discharge packets',value:records.length,subtext:'Synthetic aftercare set',tone:'info'},{label:'Ready for review',value:review,subtext:'Needs clinician pass',tone:review?'warn':'ok'},{label:'Ready to print / closed',value:printable,subtext:'Operationally mature',tone:'ok'},{label:'Thin packets',value:thin,subtext:'Needs more instruction depth',tone:thin?'warn':'ok'}]; },
  preview:(rec, h) => `DISCHARGE PACKET

Patient: ${rec.patientName || '—'}
Encounter type: ${rec.encounterType || '—'}
Discharge date: ${h.formatDate(rec.dischargeDate)}
Status: ${rec.status || '—'}
Completeness: ${rec.completenessLabel || '—'}

Diagnosis / summary
${rec.diagnosis || '—'}

Medication changes
${rec.medicationChanges || '—'}

Restrictions / guidance
${rec.restrictions || '—'}

Return precautions
${rec.returnPrecautions || '—'}

Follow-up appointments / next steps
${rec.followupAppointments || '—'}

Packet notes
${rec.packetStatus || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.encounterType || 'Discharge'}`,
  sortRecords:(rows) => rows.sort((a,b)=> String(b.dischargeDate||'').localeCompare(String(a.dischargeDate||'')))
});
