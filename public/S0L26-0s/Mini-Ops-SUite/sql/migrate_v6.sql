-- v6 migration: per-epoch key wrapping per-vault keys + per-vault access control
-- Safe to run multiple times.

create table if not exists sync_vault_keys(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  vault_key text not null,
  epoch bigint not null,
  wrap jsonb not null,
  restricted boolean not null default false,
  created_by uuid references sync_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, vault_key)
);

create table if not exists sync_vault_access(
  org_id uuid not null,
  vault_key text not null,
  user_id uuid not null references sync_users(id) on delete cascade,
  perm text not null check (perm in ('viewer','editor')),
  created_by uuid references sync_users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, vault_key, user_id),
  foreign key (org_id, vault_key) references sync_vault_keys(org_id, vault_key) on delete cascade
);

create index if not exists idx_sync_vault_keys_org on sync_vault_keys(org_id);
create index if not exists idx_sync_vault_access_org_vault on sync_vault_access(org_id, vault_key);

-- NOTE: Upgrading an org's key_model to wrapped-epoch-vault-v1 is performed by the client (Sync Console),
-- because it requires decrypting existing vault blobs and re-encrypting them with per-vault keys once.
