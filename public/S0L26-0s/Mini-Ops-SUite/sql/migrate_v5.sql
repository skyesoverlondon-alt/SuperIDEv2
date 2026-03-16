-- Migration v5: Per-member wrapped DEK (E2EE without shared passphrase)

-- 1) Add encryption public key column for members (ECDH P-256 public JWK)
alter table sync_users add column if not exists enc_pubkey_jwk jsonb;

-- 2) Create per-member DEK wraps table
create table if not exists sync_dek_wraps(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  epoch bigint not null,
  user_id uuid not null references sync_users(id) on delete cascade,
  wrap jsonb not null,
  created_by uuid references sync_users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, epoch, user_id)
);

create index if not exists idx_sync_dek_wraps_org_epoch on sync_dek_wraps(org_id, epoch);

-- 3) Add org key model flag (default legacy for existing orgs)
alter table sync_orgs add column if not exists key_model text;
update sync_orgs set key_model = 'passphrase-v1' where key_model is null;
