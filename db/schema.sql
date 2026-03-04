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

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  org_id uuid references orgs(id),
  created_at timestamptz not null default now()
);

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
  netlify_site_id text,
  netlify_site_name text,
  updated_at timestamptz not null default now()
);

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