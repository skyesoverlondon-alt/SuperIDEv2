-- v9 enterprise hardening: org policy + deviceId in challenges + tamper-evident audit fields

alter table sync_orgs add column if not exists policy jsonb not null default '{}'::jsonb;

alter table sync_challenges add column if not exists device_id text;

alter table sync_audit add column if not exists device_id text;
alter table sync_audit add column if not exists severity text not null default 'info';
alter table sync_audit add column if not exists req_id text;
alter table sync_audit add column if not exists ip text;
alter table sync_audit add column if not exists ua text;
alter table sync_audit add column if not exists prev_hash text;
alter table sync_audit add column if not exists hash text;

create index if not exists idx_sync_audit_org_id_id on sync_audit(org_id, id);
