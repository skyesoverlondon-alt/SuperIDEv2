--
-- Database schema for kAIxU Super IDE vNext.
--
-- This schema defines organisations, users, sessions, workspaces,
-- audit events and integration pointers.  Tokens and secrets
-- for external providers are never stored in the database; they
-- live in the Worker vault encrypted at rest.  Only IDs and
-- metadata are persisted here.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table if exists orgs add column if not exists plan_tier text not null default 'base';
alter table if exists orgs add column if not exists seat_limit integer;
alter table if exists orgs add column if not exists allow_personal_key_override boolean not null default false;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  recovery_email text,
  pin_hash text,
  pin_updated_at timestamptz,
  password_hash text not null,
  org_id uuid references orgs(id),
  created_at timestamptz not null default now()
);

alter table if exists users add column if not exists recovery_email text;
alter table if exists users add column if not exists pin_hash text;
alter table if exists users add column if not exists pin_updated_at timestamptz;

create index if not exists idx_users_recovery_email on users(lower(recovery_email));

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  files_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ws_org on workspaces(org_id);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  org_id uuid,
  ws_id uuid,
  type text not null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_audit_ws on audit_events(ws_id, at desc);

-- Integration pointers.  For GitHub we store the repo, owner,
-- branch and installation_id (from GitHub App).  For Netlify we
-- store the site ID and optional site name.  No access tokens are
-- persisted; the Worker obtains tokens on demand via GitHub App
-- installation and uses vaulted tokens for Netlify.

create table if not exists integrations (
  user_id uuid primary key references users(id) on delete cascade,
  github_repo text,
  github_owner text,
  github_branch text default 'main',
  github_installation_id bigint,
  skyedrive_ws_id uuid,
  skyedrive_record_id uuid,
  skyedrive_title text,
  netlify_site_id text,
  netlify_site_name text,
  updated_at timestamptz not null default now()
);

alter table if exists integrations add column if not exists skyedrive_ws_id uuid;
alter table if exists integrations add column if not exists skyedrive_record_id uuid;
alter table if exists integrations add column if not exists skyedrive_title text;

-- Shared auth + RBAC memberships across all Skye apps
create table if not exists org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_org_memberships_org on org_memberships(org_id);

-- Secure invite links for team onboarding.
create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  invited_by uuid references users(id),
  invited_email text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_org_invites_org_status on org_invites(org_id, status, created_at desc);
create index if not exists idx_org_invites_email on org_invites(lower(invited_email), status);

-- Password reset tokens for account recovery.
create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_tokens_user on password_reset_tokens(user_id, created_at desc);
create index if not exists idx_password_reset_tokens_expiry on password_reset_tokens(expires_at, used_at);

-- Workspace-level access controls for enterprise role boundaries.
create table if not exists workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  ws_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (ws_id, user_id)
);

create index if not exists idx_workspace_memberships_ws on workspace_memberships(ws_id, role, created_at desc);
create index if not exists idx_workspace_memberships_user on workspace_memberships(user_id, ws_id);

-- Generic app records to back SkyeDocs/Sheets/Slides/Mail/etc.
-- `.skye` imports persist only decrypted canonical app state here.
-- Encrypted envelopes, passphrases, and external provider secrets stay client-side or in the Worker vault.
create table if not exists app_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete cascade,
  app text not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_records_org_app on app_records(org_id, app, updated_at desc);
create index if not exists idx_app_records_org_mail_updated on app_records(org_id, updated_at desc) where app='SkyeMail';
create index if not exists idx_app_records_org_chat_updated on app_records(org_id, updated_at desc) where app='SkyeChat';
create index if not exists idx_app_records_chat_channel on app_records(org_id, (lower(payload->>'channel')), updated_at desc) where app='SkyeChat';

-- SkyeTasks board entities
create table if not exists skye_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'backlog' check (status in ('backlog','doing','done')),
  assignee_user_id uuid references users(id),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_skye_tasks_org_status on skye_tasks(org_id, status, updated_at desc);

-- Per-app smoke run evidence
create table if not exists app_smoke_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  app text not null,
  source text not null default 'manual' check (source in ('manual','auto')),
  status text not null check (status in ('pass','fail')),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists idx_app_smoke_runs_app_at on app_smoke_runs(app, at desc);

-- Machine/API token issuance for automation and external tools.
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  issued_by uuid references users(id),
  label text,
  token_hash text not null unique,
  prefix text not null,
  locked_email text,
  scopes_json jsonb not null default '["generate"]'::jsonb,
  status text not null default 'active' check (status in ('active','revoked')),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists api_tokens add column if not exists locked_email text;
alter table if exists api_tokens add column if not exists scopes_json jsonb not null default '["generate"]'::jsonb;

create index if not exists idx_api_tokens_org_created on api_tokens(org_id, created_at desc);
create index if not exists idx_api_tokens_status on api_tokens(status, expires_at);
create index if not exists idx_api_tokens_locked_email on api_tokens(locked_email);
create index if not exists idx_api_tokens_scopes on api_tokens using gin (scopes_json);

create table if not exists ai_brain_usage_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  actor_email text,
  actor_user_id uuid references users(id) on delete set null,
  org_id uuid references orgs(id) on delete set null,
  ws_id uuid references workspaces(id) on delete set null,
  app text not null,
  auth_type text not null default 'unknown',
  api_token_id uuid references api_tokens(id) on delete set null,
  api_token_label text,
  api_token_locked_email text,
  used_backup boolean not null default false,
  brain_route text not null check (brain_route in ('primary','backup')),
  provider text,
  model text,
  gateway_request_id text,
  backup_request_id text,
  gateway_status integer,
  backup_status integer,
  usage_json jsonb not null default '{}'::jsonb,
  billing_json jsonb not null default '{}'::jsonb,
  success boolean not null default true
);

create index if not exists idx_ai_brain_usage_log_org_at on ai_brain_usage_log(org_id, at desc);
create index if not exists idx_ai_brain_usage_log_ws_at on ai_brain_usage_log(ws_id, at desc);
create index if not exists idx_ai_brain_usage_log_token_at on ai_brain_usage_log(api_token_id, at desc);
create index if not exists idx_ai_brain_usage_log_backup_at on ai_brain_usage_log(used_backup, at desc);

create table if not exists org_key_policies (
  org_id uuid primary key references orgs(id) on delete cascade,
  default_token_id uuid references api_tokens(id) on delete set null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table if not exists org_user_key_assignments (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  assigned_token_id uuid references api_tokens(id) on delete set null,
  personal_token_id uuid references api_tokens(id) on delete set null,
  assigned_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists idx_org_user_key_assignments_assigned on org_user_key_assignments(assigned_token_id);
create index if not exists idx_org_user_key_assignments_personal on org_user_key_assignments(personal_token_id);

-- SkyeMail account configuration scoped to each user within an org.
create table if not exists skymail_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  mailbox_email text not null,
  display_name text,
  provider text not null default 'gmail_smtp' check (provider in ('gmail_smtp','resend','custom_smtp')),
  outbound_enabled boolean not null default true,
  inbound_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_skymail_accounts_org_user on skymail_accounts(org_id, user_id);
create index if not exists idx_skymail_accounts_mailbox on skymail_accounts(org_id, lower(mailbox_email));

-- Inbox sync checkpoints for pull-based providers and bridge workers.
create table if not exists skymail_sync_state (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  mailbox_email text not null,
  provider text not null default 'gmail_smtp',
  last_cursor text,
  last_synced_at timestamptz,
  status text not null default 'idle' check (status in ('idle','running','failed')),
  error text,
  updated_at timestamptz not null default now(),
  unique (org_id, mailbox_email, provider)
);

create index if not exists idx_skymail_sync_org_mailbox on skymail_sync_state(org_id, lower(mailbox_email), provider);

-- Sovereign command bus foundations
-- Import/export persistence is audited through sovereign_events and audit_events after app-record writes.
create table if not exists sovereign_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete set null,
  mission_id uuid,
  event_type text not null,
  event_family text not null,
  source_app text,
  source_route text,
  actor text not null,
  actor_user_id uuid references users(id) on delete set null,
  subject_kind text,
  subject_id text,
  parent_event_id uuid references sovereign_events(id) on delete set null,
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  routing_status text not null default 'accepted' check (routing_status in ('accepted','delivered','dead-lettered')),
  correlation_id text,
  idempotency_key text,
  internal_signature text,
  summary text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_sovereign_events_org_at on sovereign_events(org_id, occurred_at desc);
create index if not exists idx_sovereign_events_ws_at on sovereign_events(ws_id, occurred_at desc);
create index if not exists idx_sovereign_events_type_at on sovereign_events(event_type, occurred_at desc);
create index if not exists idx_sovereign_events_source_app_at on sovereign_events(org_id, source_app, occurred_at desc);
create index if not exists idx_sovereign_events_subject on sovereign_events(org_id, subject_kind, subject_id, occurred_at desc);
create index if not exists idx_sovereign_events_payload_gin on sovereign_events using gin (payload);

create table if not exists sovereign_event_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete cascade,
  subscriber_app text not null,
  event_family text,
  event_type text,
  scope_kind text not null default 'org' check (scope_kind in ('org','workspace','mission')),
  scope_id text,
  enabled boolean not null default true,
  filter_json jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sovereign_event_subscriptions_scope on sovereign_event_subscriptions(org_id, scope_kind, enabled, created_at desc);

create table if not exists sovereign_event_dead_letters (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references sovereign_events(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete set null,
  subscriber_app text,
  failed_at timestamptz not null default now(),
  attempts integer not null default 1,
  error text,
  last_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_sovereign_event_dead_letters_org_failed on sovereign_event_dead_letters(org_id, failed_at desc);

create table if not exists timeline_entries (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete set null,
  mission_id uuid,
  event_id uuid references sovereign_events(id) on delete set null,
  audit_event_id uuid references audit_events(id) on delete set null,
  entry_type text not null,
  source_app text,
  actor text not null,
  actor_user_id uuid references users(id) on delete set null,
  subject_kind text,
  subject_id text,
  title text not null,
  summary text,
  visibility text not null default 'standard' check (visibility in ('standard','privileged','redacted')),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists idx_timeline_entries_org_at on timeline_entries(org_id, at desc);
create index if not exists idx_timeline_entries_ws_at on timeline_entries(ws_id, at desc);
create index if not exists idx_timeline_entries_subject on timeline_entries(org_id, subject_kind, subject_id, at desc);

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete set null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','active','blocked','completed','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  owner_user_id uuid references users(id) on delete set null,
  goals_json jsonb not null default '[]'::jsonb,
  linked_apps_json jsonb not null default '[]'::jsonb,
  variables_json jsonb not null default '{}'::jsonb,
  entitlement_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_missions_org_status on missions(org_id, status, updated_at desc);

create table if not exists mission_collaborators (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  email text,
  role text not null default 'collaborator' check (role in ('owner','collaborator','viewer')),
  added_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mission_id, user_id, email)
);

create index if not exists idx_mission_collaborators_mission on mission_collaborators(mission_id, role, created_at desc);

create table if not exists mission_assets (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  source_app text,
  asset_kind text,
  asset_id text not null,
  title text,
  detail jsonb not null default '{}'::jsonb,
  attached_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mission_id, asset_id)
);

create index if not exists idx_mission_assets_mission on mission_assets(mission_id, created_at desc);

create table if not exists contractor_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete set null,
  mission_id uuid references missions(id) on delete set null,
  event_id uuid references sovereign_events(id) on delete set null,
  source_app text not null default 'ContractorNetwork',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null,
  business_name text,
  email text not null,
  phone text,
  coverage text,
  availability text not null default 'unknown',
  lanes jsonb not null default '[]'::jsonb,
  service_summary text not null,
  proof_link text,
  entity_type text not null default 'independent_contractor',
  licenses text,
  status text not null default 'new',
  admin_notes text not null default '',
  tags text[] not null default ARRAY[]::text[],
  verified boolean not null default false,
  dispatched boolean not null default false,
  last_contacted_at timestamptz
);

alter table if exists contractor_submissions add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table if exists contractor_submissions add column if not exists ws_id uuid references workspaces(id) on delete set null;
alter table if exists contractor_submissions add column if not exists mission_id uuid references missions(id) on delete set null;
alter table if exists contractor_submissions add column if not exists event_id uuid references sovereign_events(id) on delete set null;
alter table if exists contractor_submissions add column if not exists source_app text not null default 'ContractorNetwork';

create index if not exists idx_contractor_submissions_org_created_at on contractor_submissions (org_id, created_at desc);
create index if not exists idx_contractor_submissions_ws_created_at on contractor_submissions (ws_id, created_at desc);
create index if not exists idx_contractor_submissions_mission_created_at on contractor_submissions (mission_id, created_at desc);
create index if not exists idx_contractor_submissions_status on contractor_submissions (status);
create index if not exists idx_contractor_submissions_email on contractor_submissions (email);
create index if not exists idx_contractor_submissions_lanes_gin on contractor_submissions using gin (lanes);
create index if not exists idx_contractor_submissions_tags_gin on contractor_submissions using gin (tags);

create table if not exists submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references contractor_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  blob_key text not null,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  bytes integer not null default 0
);

create index if not exists idx_submission_files_submission_id on submission_files (submission_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_contractor_submissions_updated_at on contractor_submissions;
create trigger trg_contractor_submissions_updated_at
before update on contractor_submissions
for each row
execute function set_updated_at();

create table if not exists contractor_income_entries (
  id uuid primary key default gen_random_uuid(),
  contractor_submission_id uuid not null references contractor_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entry_date date not null,
  source_name text not null,
  source_type text not null default 'manual',
  reference_code text,
  gross_amount numeric(12,2) not null default 0,
  fee_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  category text not null default 'general',
  notes text not null default '',
  proof_url text,
  verification_status text not null default 'unreviewed',
  verification_notes text not null default '',
  created_by text not null default 'admin'
);

create table if not exists contractor_expense_entries (
  id uuid primary key default gen_random_uuid(),
  contractor_submission_id uuid not null references contractor_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entry_date date not null,
  vendor_name text not null,
  category text not null default 'general',
  amount numeric(12,2) not null default 0,
  deductible_percent numeric(5,2) not null default 100,
  notes text not null default '',
  proof_url text,
  verification_status text not null default 'unreviewed',
  verification_notes text not null default '',
  created_by text not null default 'admin'
);

create table if not exists contractor_verification_packets (
  id uuid primary key default gen_random_uuid(),
  contractor_submission_id uuid not null references contractor_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  verification_tier text not null default 'company_verified',
  issued_by_name text not null default 'Skyes Over London',
  issued_by_title text not null default 'Chief Executive Officer',
  company_name text not null default 'Skyes Over London',
  company_email text not null default 'SkyesOverLondonLC@solenterprises.org',
  company_phone text not null default '4804695416',
  statement_text text not null default '',
  packet_notes text not null default '',
  packet_hash text,
  unique (contractor_submission_id, period_start, period_end)
);

create index if not exists idx_contractor_income_entries_submission on contractor_income_entries(contractor_submission_id, entry_date desc);
create index if not exists idx_contractor_expense_entries_submission on contractor_expense_entries(contractor_submission_id, entry_date desc);
create index if not exists idx_contractor_verification_packets_submission on contractor_verification_packets(contractor_submission_id, period_start desc, period_end desc);

drop trigger if exists trg_contractor_income_entries_updated_at on contractor_income_entries;
create trigger trg_contractor_income_entries_updated_at
before update on contractor_income_entries
for each row
execute function set_updated_at();

drop trigger if exists trg_contractor_expense_entries_updated_at on contractor_expense_entries;
create trigger trg_contractor_expense_entries_updated_at
before update on contractor_expense_entries
for each row
execute function set_updated_at();

drop trigger if exists trg_contractor_verification_packets_updated_at on contractor_verification_packets;
create trigger trg_contractor_verification_packets_updated_at
before update on contractor_verification_packets
for each row
execute function set_updated_at();

create table if not exists gate_capability_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ws_id uuid references workspaces(id) on delete set null,
  mission_id uuid,
  subject_kind text not null check (subject_kind in ('user','workspace','mission','token')),
  subject_id text not null,
  issued_by uuid references users(id) on delete set null,
  snapshot_json jsonb not null default '{}'::jsonb,
  access_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_gate_capability_snapshots_subject on gate_capability_snapshots(org_id, subject_kind, subject_id, created_at desc);