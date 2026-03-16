-- v11 Enterprise: token binding (PoP), device posture checks, per-user token version, audit proof packs
begin;

-- ---------- Audit: persist canonical event timestamp string used for hash recomputation ----------
alter table sync_audit add column if not exists event_ts text;

-- ---------- Users: per-user token version to invalidate sessions on deprovision ----------
alter table sync_users add column if not exists token_version int not null default 1;

-- ---------- Token binding nonce cache (replay protection) ----------
create table if not exists sync_token_nonces(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  user_id uuid not null references sync_users(id) on delete cascade,
  nonce text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, nonce)
);
create index if not exists idx_sync_token_nonces_expires on sync_token_nonces(expires_at);

-- ---------- Device posture ----------
create table if not exists sync_device_posture(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  user_id uuid not null references sync_users(id) on delete cascade,
  device_id text not null,
  posture jsonb not null,
  posture_hash text not null,
  status text not null default 'unknown',
  reasons jsonb not null default '[]'::jsonb,
  assessed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (org_id, user_id, device_id)
);

commit;
