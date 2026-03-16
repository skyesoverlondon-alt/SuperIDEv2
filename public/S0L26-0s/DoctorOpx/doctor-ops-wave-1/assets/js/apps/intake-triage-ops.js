window.DOCTOR_OPS.createApp({
  id:"intake-triage-ops",
  title:"Intake & Triage Ops",
  subtitle:"Front-door acuity command for clinics and doctor offices.",
  blurb:"Synthetic-only intake board with acuity sorting, rooming status, vitals capture, escalation flags, and a generated triage summary.",
  recordLabel:"triage case",
  previewTitle:"Generated triage summary",
  emptyCopy:"No triage cases yet.",
  statusField:"status",
  priorityField:"acuity",
  defaultValues:{"status": "new", "acuity": "routine", "arrivalMode": "walk-in"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "dob", "label": "Date of birth", "type": "date"}, {"name": "arrivalDate", "label": "Arrival date", "type": "date"}, {"name": "acuity", "label": "Acuity", "type": "select", "options": ["routine", "urgent", "emergent"]}, {"name": "chiefComplaint", "label": "Chief complaint", "type": "text", "full": true}, {"name": "symptoms", "label": "Symptoms", "type": "textarea", "rows": 4, "full": true}, {"name": "onset", "label": "Onset / duration", "type": "text"}, {"name": "arrivalMode", "label": "Arrival mode", "type": "select", "options": ["walk-in", "scheduled", "wheelchair", "EMS", "transfer"]}, {"name": "bp", "label": "Blood pressure", "type": "text"}, {"name": "pulse", "label": "Pulse", "type": "text"}, {"name": "temp", "label": "Temperature", "type": "text"}, {"name": "oxygen", "label": "SpO₂", "type": "text"}, {"name": "allergyFlags", "label": "Allergy flags", "type": "text", "full": true}, {"name": "triageNotes", "label": "Triage notes", "type": "textarea", "rows": 5, "full": true}, {"name": "status", "label": "Status", "type": "select", "options": ["new", "waiting", "roomed", "provider-seen", "closed"]}],
  statusOptions:["new", "waiting", "roomed", "provider-seen", "closed"],
  priorityOptions:["routine", "urgent", "emergent"],
  detailKeys:["patientName", "dob", "arrivalDate", "acuity", "chiefComplaint", "status", "arrivalMode", "bp", "pulse", "temp", "oxygen", "allergyFlags"],
  sampleRecords:[{"patientName": "Jordan Vale", "dob": "1986-04-21", "arrivalDate": "2026-03-16", "acuity": "urgent", "chiefComplaint": "Chest tightness", "symptoms": "Intermittent chest tightness for 2 hours, mild dyspnea, no syncope.", "onset": "2 hours", "arrivalMode": "walk-in", "bp": "146/92", "pulse": "108", "temp": "99.1 F", "oxygen": "96%", "allergyFlags": "Penicillin", "triageNotes": "Escalate quickly due to chest symptoms and tachycardia.", "status": "roomed"}, {"patientName": "Taylor Brooks", "dob": "1972-07-09", "arrivalDate": "2026-03-16", "acuity": "emergent", "chiefComplaint": "Facial droop concern", "symptoms": "Family reports sudden facial droop and slurred speech 20 minutes ago.", "onset": "20 minutes", "arrivalMode": "wheelchair", "bp": "168/104", "pulse": "94", "temp": "98.7 F", "oxygen": "97%", "allergyFlags": "Latex", "triageNotes": "Immediate escalation.", "status": "waiting"}],
  columns:[{key:"patientName"},{key:"chiefComplaint"},{key:"acuity",badge:true},{key:"status",badge:true},{key:"arrivalDate",type:"date"},{get:(rec)=> rec.waitLabel}],
  compute:(rec, h) => { const d=h.daysBetween(rec.arrivalDate); rec.waitLabel=d===null?'—':`${d}d in system`; rec.escalate=/chest|droop|slurred|stroke|shortness/i.test(`${rec.chiefComplaint} ${rec.symptoms}`)||rec.acuity==='emergent'; return rec; },
  metrics:(records) => { const urgent=records.filter(r=>['urgent','emergent'].includes(r.acuity)).length; const waiting=records.filter(r=>['new','waiting'].includes(r.status)).length; const esc=records.filter(r=>r.escalate).length; return [{label:'Total cases',value:records.length,subtext:'Synthetic triage queue',tone:'info'},{label:'Urgent / emergent',value:urgent,subtext:'Needs rapid eyes-on',tone:urgent?'danger':'ok'},{label:'Waiting',value:waiting,subtext:'Still front-of-house',tone:waiting?'warn':'ok'},{label:'Escalation flags',value:esc,subtext:'Keyword or acuity triggered',tone:esc?'danger':'ok'}]; },
  preview:(rec, h) => `TRIAGE SUMMARY

Patient: ${rec.patientName || '—'}
DOB: ${h.formatDate(rec.dob)}
Arrival: ${h.formatDate(rec.arrivalDate)} via ${rec.arrivalMode || '—'}
Chief complaint: ${rec.chiefComplaint || '—'}
Symptoms: ${rec.symptoms || '—'}
Onset: ${rec.onset || '—'}

Vitals
- BP: ${rec.bp || '—'}
- Pulse: ${rec.pulse || '—'}
- Temp: ${rec.temp || '—'}
- SpO₂: ${rec.oxygen || '—'}

Acuity: ${rec.acuity || '—'}
Status: ${rec.status || '—'}
Allergy flags: ${rec.allergyFlags || '—'}

Triage notes:
${rec.triageNotes || '—'}

Escalation flag: ${rec.escalate ? 'YES — immediate review recommended.' : 'No automatic escalation flag.'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.chiefComplaint || 'No complaint'}`,
  sortRecords:(rows) => rows.sort((a,b)=>({emergent:3,urgent:2,routine:1}[b.acuity]||0)-({emergent:3,urgent:2,routine:1}[a.acuity]||0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
});
