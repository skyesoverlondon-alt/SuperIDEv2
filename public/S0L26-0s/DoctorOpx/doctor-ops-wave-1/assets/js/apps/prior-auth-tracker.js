window.DOCTOR_OPS.createApp({
  id:"prior-auth-tracker",
  title:"Prior Auth Tracker",
  subtitle:"Payer decision lane with deadlines, appeals, and owner accountability.",
  blurb:"Track what was submitted, when it is due back, who owns it, and whether you are in additional-info limbo, approval, denial, or appeal.",
  recordLabel:"prior auth",
  previewTitle:"Generated auth summary",
  emptyCopy:"No prior auths yet.",
  statusField:"status",
  priorityField:"priority",
  defaultValues:{"status": "draft", "priority": "standard"},
  fields:[{"name": "patientName", "label": "Patient name", "type": "text"}, {"name": "payer", "label": "Payer", "type": "text"}, {"name": "item", "label": "Medication / procedure", "type": "text", "full": true}, {"name": "diagnosis", "label": "Diagnosis / rationale", "type": "textarea", "rows": 4, "full": true}, {"name": "priority", "label": "Priority", "type": "select", "options": ["standard", "expedited", "urgent"]}, {"name": "submissionDate", "label": "Submission date", "type": "date"}, {"name": "decisionDueDate", "label": "Decision due date", "type": "date"}, {"name": "status", "label": "Status", "type": "select", "options": ["draft", "submitted", "additional-info", "approved", "denied", "appeal", "closed"]}, {"name": "refNumber", "label": "Reference number", "type": "text"}, {"name": "owner", "label": "Owner", "type": "text"}, {"name": "notes", "label": "Auth notes", "type": "textarea", "rows": 5, "full": true}],
  statusOptions:["draft", "submitted", "additional-info", "approved", "denied", "appeal", "closed"],
  priorityOptions:["standard", "expedited", "urgent"],
  detailKeys:["patientName", "payer", "item", "priority", "submissionDate", "decisionDueDate", "status", "refNumber", "owner"],
  sampleRecords:[{"patientName": "Alex Mercer", "payer": "Apex Health", "item": "GLP-1 therapy renewal", "diagnosis": "Type 2 diabetes with obesity; prior response documented.", "priority": "expedited", "submissionDate": "2026-03-08", "decisionDueDate": "2026-03-18", "status": "submitted", "refNumber": "AX-88217", "owner": "Jamie P.", "notes": "Office note and A1c attached."}],
  columns:[{key:"patientName"},{key:"item"},{key:"payer"},{key:"priority",badge:true},{key:"status",badge:true},{get:(rec)=> rec.waitState}],
  compute:(rec, h) => { const wait=h.daysBetween(rec.submissionDate); const due=h.daysBetween(rec.decisionDueDate); rec.waitState=wait===null?'no submit date':`${wait}d since submit`; if(!['approved','closed'].includes(rec.status)){ if(due!==null && due>0) rec.waitState += ` • ${due}d overdue`; else if(due===0) rec.waitState += ' • due today'; else if(due!==null) rec.waitState += ` • ${Math.abs(due)}d left`; } return rec; },
  metrics:(records) => { const inflight=records.filter(r=>['submitted','additional-info','appeal'].includes(r.status)).length; const denied=records.filter(r=>r.status==='denied').length; const approved=records.filter(r=>['approved','closed'].includes(r.status)).length; const pressure=records.filter(r=>/overdue|due today/.test(String(r.waitState))).length; return [{label:'Total auths',value:records.length,subtext:'Payer work queue',tone:'info'},{label:'In flight',value:inflight,subtext:'Still under review',tone:inflight?'warn':'ok'},{label:'Approved / closed',value:approved,subtext:'Papers beat the beast',tone:'ok'},{label:'Denied',value:denied,subtext:'Needs appeal',tone:denied?'danger':'ok'},{label:'Deadline pressure',value:pressure,subtext:'Overdue or due today',tone:pressure?'danger':'ok'}]; },
  preview:(rec, h) => `PRIOR AUTH SUMMARY

Patient: ${rec.patientName || '—'}
Payer: ${rec.payer || '—'}
Medication / procedure: ${rec.item || '—'}
Priority: ${rec.priority || '—'}
Submitted: ${h.formatDate(rec.submissionDate)}
Decision due: ${h.formatDate(rec.decisionDueDate)}
Status: ${rec.status || '—'}
Reference #: ${rec.refNumber || '—'}
Owner: ${rec.owner || '—'}

Clinical rationale:
${rec.diagnosis || '—'}

Notes:
${rec.notes || '—'}

Queue state: ${rec.waitState || '—'}`,
  recordTitle:(rec) => `${rec.patientName || 'Unnamed'} — ${rec.item || 'Auth item'}`,
  sortRecords:(rows) => rows.sort((a,b)=> String(a.decisionDueDate||'9999').localeCompare(String(b.decisionDueDate||'9999')) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
});
