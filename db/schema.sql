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