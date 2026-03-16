-- Migration to SkyeSync v4 (CRDT conflict merge + org key rotation)

-- 1) Org key epochs + token versioning
alter table if exists sync_orgs add column if not exists key_epoch bigint not null default 1;
alter table if exists sync_orgs add column if not exists token_version int not null default 1;
alter table if exists sync_orgs add column if not exists rotated_at timestamptz;

-- 2) Org epoch history
create table if not exists sync_org_epochs(
  org_id uuid not null references sync_orgs(id) on delete cascade,
  epoch bigint not null,
  org_salt_b64 text not null,
  org_kdf_iterations int not null default 250000,
  created_at timestamptz not null default now(),
  primary key (org_id, epoch)
);
create index if not exists idx_sync_org_epochs_org on sync_org_epochs(org_id);

-- Backfill epoch=1 for existing orgs (idempotent)
insert into sync_org_epochs(org_id, epoch, org_salt_b64, org_kdf_iterations)
select id, 1, org_salt_b64, org_kdf_iterations
from sync_orgs
on conflict (org_id, epoch) do nothing;

-- 3) User revocation timestamp
alter table if exists sync_users add column if not exists revoked_at timestamptz;

-- 4) Vault epoch
alter table if exists sync_vaults add column if not exists epoch bigint not null default 1;
update sync_vaults set epoch = 1 where epoch is null;
