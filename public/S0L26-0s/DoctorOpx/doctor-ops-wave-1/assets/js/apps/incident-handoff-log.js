window.DOCTOR_OPS.createApp({
  id:"incident-handoff-log",
  title:"Incident & Handoff Log",
  subtitle:"Clinical ops event ledger for incident tracking, immediate actions, and owner handoff.",
  blurb:"A sober logbook for operational incidents, near-misses, staffing handoffs, and resolution tracking.",
  recordLabel:"incident",
  previewTitle:"Generated incident brief",
  emptyCopy:"No incidents yet.",
  statusField:"status",
  priorityField:"severity",
  defaultValues:{"status": "open", "severity": "minor"},
  fields:[{"name": "caseName", "label": "Patient / unit / shift label", "type": "text"}, {"name": "incidentType", "label": "Incident type", "type": "text"}, {"name": "eventDate", "label": "Event date", "type": "date"}, {"name": "severity", "label": "Severity", "type": "select", "options": ["minor", "moderate", "major", "critical"]}, {"name": "summary", "label": "Incident summary", "type": "textarea", "rows": 5, "full": true}, {"name": "immediateActions", "label": "Immediate actions taken", "type": "textarea", "rows": 4, "full": true}, {"name": "handoffTo", "label": "Handoff to", "type": "text"}, {"name": "followupOwner", "label": "Follow-up owner", "type": "text"}, {"name": "resolutionDate", "label": "Resolution date", "type": "date"}, {"name": "status", "label": "Status", "type": "select", "options": ["open", "under-review", "handoff-complete", "resolved", "closed"]}, {"name": "notes", "label": "Additional notes", "type": "textarea", "rows": 4, "full": true}],
  statusOptions:["open", "under-review", "handoff-complete", "resolved", "closed"],
  priorityOptions:["minor", "moderate", "major", "critical"],
  detailKeys:["caseName", "incidentType", "eventDate", "severity", "handoffTo", "followupOwner", "resolutionDate", "status"],
  sampleRecords:[{"caseName": "Pod A / Room turnover", "incidentType": "Specimen label near-miss", "eventDate": "2026-03-15", "severity": "major", "summary": "Specimen label mismatch caught before send-out.", "immediateActions": "Stopped processing, verified identifiers, re-labeled correctly, notified lead.", "handoffTo": "Charge nurse", "followupOwner": "Clinic manager", "resolutionDate": "", "status": "under-review", "notes": "Root-cause review pending."}],
  columns:[{key:"caseName"},{key:"incidentType"},{key:"severity",badge:true},{key:"status",badge:true},{key:"eventDate",type:"date"},{get:(rec)=> rec.openState}],
  compute:(rec, h) => { const age=h.daysBetween(rec.eventDate); if(['resolved','closed'].includes(rec.status) && rec.resolutionDate){ const res=h.daysBetween(rec.eventDate, rec.resolutionDate); rec.openState=`resolved in ${Math.max(res,0)}d`; } else if(age!==null) rec.openState=`${age}d open`; else rec.openState='no date'; return rec; },
  metrics:(records) => { const open=records.filter(r=>['open','under-review','handoff-complete'].includes(r.status)).length; const critical=records.filter(r=>['major','critical'].includes(r.severity)).length; const resolved=records.filter(r=>['resolved','closed'].includes(r.status)).length; return [{label:'Incident records',value:records.length,subtext:'Synthetic operational log',tone:'info'},{label:'Open / under review',value:open,subtext:'Still live in operations',tone:open?'warn':'ok'},{label:'Major / critical',value:critical,subtext:'Needs sharp management',tone:critical?'danger':'ok'},{label:'Resolved / closed',value:resolved,subtext:'Documented closure',tone:'ok'}]; },
  preview:(rec, h) => `INCIDENT BRIEF

Case / unit: ${rec.caseName || '—'}
Incident type: ${rec.incidentType || '—'}
Event date: ${h.formatDate(rec.eventDate)}
Severity: ${rec.severity || '—'}
Status: ${rec.status || '—'}
Handoff to: ${rec.handoffTo || '—'}
Follow-up owner: ${rec.followupOwner || '—'}
Resolution date: ${h.formatDate(rec.resolutionDate)}

Summary
${rec.summary || '—'}

Immediate actions
${rec.immediateActions || '—'}

Additional notes
${rec.notes || '—'}

Open-state: ${rec.openState || '—'}`,
  recordTitle:(rec) => `${rec.caseName || 'Unnamed'} — ${rec.incidentType || 'Incident'}`,
  sortRecords:(rows) => rows.sort((a,b)=>({critical:4,major:3,moderate:2,minor:1}[b.severity]||0)-({critical:4,major:3,moderate:2,minor:1}[a.severity]||0) || String(b.eventDate||'').localeCompare(String(a.eventDate||'')))
});
