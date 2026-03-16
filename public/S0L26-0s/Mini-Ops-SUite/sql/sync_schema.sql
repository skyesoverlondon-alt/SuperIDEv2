-- SkyeSync schema (Postgres / Neon)

create table if not exists sync_orgs(
  id uuid primary key,
  name text not null,
  org_salt_b64 text not null,
  org_kdf_iterations int not null default 250000,
  key_epoch bigint not null default 1,
  token_version int not null default 1,
  -- 'wrapped-epoch-vault-v1' (recommended), 'wrapped-dek-v1' (legacy v5), or 'passphrase-v1' (legacy)
  key_model text not null default 'wrapped-epoch-vault-v1',
  -- Enterprise policy controls (JSON). Enforced server-side.
  -- Example: {"ipAllowlist":["10.0.0.0/8"],"sessionTtlSec":86400,"maxCiphertextBytes":5500000,"requireDeviceId":true}
  policy jsonb not null default '{}'::jsonb,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Historical salts/epochs (server still cannot decrypt anything; this is metadata for clients).
create table if not exists sync_org_epochs(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  epoch bigint not null,
  org_salt_b64 text not null,
  org_kdf_iterations int not null default 250000,
  created_at timestamptz not null default now(),
  primary key (org_id, epoch)
);

create table if not exists sync_users(
  id uuid primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  name text,
  role text not null check (role in ('owner','admin','editor','viewer')),
  -- Authentication key (ECDSA P-256) used for challenge signing
  pubkey_jwk jsonb not null,
  -- Encryption key (ECDH P-256) used to unwrap the org Data Encryption Key (DEK)
  enc_pubkey_jwk jsonb not null,
  status text not null default 'active',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Per-member wrapped org epoch key (EDEK): server stores ciphertext only; clients unwrap using ECDH private key.
-- In key_model wrapped-dek-v1, this key is the org DEK (used directly to encrypt vaults).
-- In key_model wrapped-epoch-vault-v1, this key is the per-epoch KEK that wraps per-vault keys.
create table if not exists sync_dek_wraps(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  epoch bigint not null,
  user_id uuid not null references sync_users(id) on delete cascade,
  wrap jsonb not null,
  created_by uuid references sync_users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, epoch, user_id)
);

-- Per-vault Data Encryption Keys (VDEKs) wrapped by the org epoch key (EDEK).
create table if not exists sync_vault_keys(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  vault_key text not null,
  epoch bigint not null,
  key_rev bigint not null default 1,
  wrap jsonb not null, -- {ivB64,dataB64} AES-GCM over 32-byte raw vault key using epoch key
  restricted boolean not null default false, -- if true, access controlled via sync_vault_access
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

create table if not exists sync_challenges(
  id uuid primary key,
  org_id uuid not null,
  user_id uuid not null,
  device_id text,
  nonce text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Basic DB-backed rate limiting (production hardening).
-- Bucket is an arbitrary string (e.g. "challenge:IP" or "invite-create:org:user").
-- Windowed counter prevents brute force / spam without any third-party dependencies.
create table if not exists sync_rate_limits(
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  created_at timestamptz not null default now(),
  primary key(bucket, window_start)
);

create table if not exists sync_invites(
  id uuid primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  role text not null check (role in ('admin','editor','viewer')),
  code_hash text not null,
  created_by uuid references sync_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references sync_users(id),
  used_at timestamptz
);

create table if not exists sync_vaults(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  vault_key text not null,
  epoch bigint not null default 1,
  rev bigint not null default 0,
  ciphertext_b64 text not null,
  meta jsonb,
  updated_by uuid references sync_users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, vault_key)
);

create table if not exists sync_audit(
  id bigserial primary key,
  org_id uuid,
  user_id uuid,
  device_id text,
  action text not null,
  severity text not null default 'info',
  detail jsonb,
  req_id text,
  ip text,
  ua text,
  prev_hash text,
  hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_users_org on sync_users(org_id);
create index if not exists idx_sync_vaults_org on sync_vaults(org_id);
create index if not exists idx_sync_invites_org on sync_invites(org_id);
create index if not exists idx_sync_org_epochs_org on sync_org_epochs(org_id);
create index if not exists idx_sync_dek_wraps_org_epoch on sync_dek_wraps(org_id, epoch);
create index if not exists idx_sync_vault_keys_org on sync_vault_keys(org_id);
create index if not exists idx_sync_vault_access_org_vault on sync_vault_access(org_id, vault_key);
create index if not exists idx_sync_audit_org_id_id on sync_audit(org_id, id);
