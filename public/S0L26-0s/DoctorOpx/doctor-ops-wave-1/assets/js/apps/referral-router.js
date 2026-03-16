window.DOCTOR_OPS.createApp({
  id:"referral-router",
  title:"Referral Router",
  subtitle:"Specialty handoff tracker with due dates and completion visibility.",
  blurb:"Keep the referral lane from turning into an administrative swamp. Track specialty, destination, due date, auth requirement, and scheduling status.",
  recordLabel:"referral",
  previewTitle:"Generated referral summary",
  emptyCopy:"No referrals yet.",
  statusField:"status",
  priorityField:"priority",
  defaultValues:{"status": "new", "priority": "routine", "authNeeded": "no"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "referralDate", "label": "Referral date", "type": "date"}, {"name": "specialty", "label": "Specialty", "type": "text"}, {"name": "referredTo", "label": "Destination clinic / doctor", "type": "text", "full": true}, {"name": "reason", "label": "Referral reason", "type": "textarea", "rows": 4, "full": true}, {"name": "priority", "label": "Priority", "type": "select", "options": ["routine", "expedited", "urgent"]}, {"name": "authNeeded", "label": "Authorization needed", "type": "select", "options": ["no", "yes"]}, {"name": "contactInfo", "label": "Destination contact info", "type": "text", "full": true}, {"name": "dueDate", "label": "Desired completion date", "type": "date"}, {"name": "scheduledDate", "label": "Scheduled date", "type": "date"}, {"name": "status", "label": "Status", "type": "select", "options": ["new", "sent", "scheduled", "completed", "closed"]}, {"name": "notes", "label": "Routing notes", "type": "textarea", "rows": 5, "full": true}],
  statusOptions:["new", "sent", "scheduled", "completed", "closed"],
  priorityOptions:["routine", "expedited", "urgent"],
  detailKeys:["patientName", "referralDate", "specialty", "referredTo", "priority", "authNeeded", "dueDate", "scheduledDate", "status", "contactInfo"],
  sampleRecords:[{"patientName": "Parker Lane", "referralDate": "2026-03-11", "specialty": "Cardiology", "referredTo": "North River Cardiology", "reason": "Palpitations and family history of early CAD.", "priority": "urgent", "authNeeded": "yes", "contactInfo": "Fax 555-0182", "dueDate": "2026-03-18", "scheduledDate": "", "status": "sent", "notes": "Need records packet and recent ECG."}],
  columns:[{key:"patientName"},{key:"specialty"},{key:"priority",badge:true},{key:"status",badge:true},{key:"dueDate",type:"date"},{get:(rec)=> rec.dueState}],
  compute:(rec, h) => { const d=h.daysBetween(rec.dueDate); if(['completed','closed'].includes(rec.status)) rec.dueState='closed'; else if(d!==null && d>0) rec.dueState=`${d}d overdue`; else if(d===0) rec.dueState='due today'; else if(d!==null) rec.dueState=`${Math.abs(d)}d left`; else rec.dueState='no due date'; return rec; },
  metrics:(records) => { const auth=records.filter(r=>r.authNeeded==='yes').length; const overdue=records.filter(r=>/overdue|due today/.test(String(r.dueState))).length; const scheduled=records.filter(r=>r.status==='scheduled').length; const completed=records.filter(r=>['completed','closed'].includes(r.status)).length; return [{label:'Total referrals',value:records.length,subtext:'Active and closed',tone:'info'},{label:'Auth required',value:auth,subtext:'Needs payer lane',tone:auth?'warn':'ok'},{label:'Overdue / due today',value:overdue,subtext:'Where friction lives',tone:overdue?'danger':'ok'},{label:'Scheduled',value:scheduled,subtext:'Appointments on calendar',tone:'ok'},{label:'Completed / closed',value:completed,subtext:'Loop closed',tone:'ok'}]; },
  preview:(rec, h) => `REFERRAL SUMMARY

Patient: ${rec.patientName || '—'}
Referral date: ${h.formatDate(rec.referralDate)}
Specialty: ${rec.specialty || '—'}
Destination: ${rec.referredTo || '—'}
Priority: ${rec.priority || '—'}
Authorization needed: ${rec.authNeeded || '—'}
Desired completion: ${h.formatDate(rec.dueDate)}
Scheduled date: ${h.formatDate(rec.scheduledDate)}
Status: ${rec.status || '—'}

Reason:
${rec.reason || '—'}

Destination contact:
${rec.contactInfo || '—'}

Routing notes:
${rec.notes || '—'}

Due-state logic: ${rec.dueState || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.specialty || 'Referral'}`,
  sortRecords:(rows) => rows.sort((a,b)=> String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
});
