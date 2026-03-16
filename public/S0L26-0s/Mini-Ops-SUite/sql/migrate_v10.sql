-- v10 Enterprise: SSO (OIDC/SAML), SCIM, WebAuthn attestation, WORM audit anchors

begin;

-- ---------- Users: add enterprise identity fields ----------
alter table sync_users add column if not exists email text;
alter table sync_users add column if not exists external_id text;
alter table sync_users add column if not exists sso_provider text;
alter table sync_users add column if not exists last_login_at timestamptz;

create unique index if not exists idx_sync_users_org_email_unique
  on sync_users(org_id, lower(email))
  where email is not null;

create unique index if not exists idx_sync_users_org_external_unique
  on sync_users(org_id, external_id)
  where external_id is not null;

-- ---------- OIDC SSO config ----------
create table if not exists sync_sso_oidc(
  org_id uuid primary key references sync_orgs(id) on delete cascade,
  issuer text not null,
  client_id text not null,
  client_secret_enc text, -- encrypted using SYNC_SECRETS_KEY
  redirect_uri text not null,
  scope text not null default 'openid email profile',
  claim_email text not null default 'email',
  claim_name text not null default 'name',
  claim_groups text not null default 'groups',
  require_verified_email boolean not null default false,
  -- optional mappings: group->role and group->vault grants
  role_map jsonb not null default '{}'::jsonb,
  vault_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- SAML SSO config ----------
create table if not exists sync_sso_saml(
  org_id uuid primary key references sync_orgs(id) on delete cascade,
  idp_sso_url text not null,
  idp_cert_pem text not null,
  sp_entity_id text not null,
  sp_acs_url text not null,
  sp_cert_pem text, -- optional, for signed AuthnRequests
  sp_key_enc text, -- encrypted private key PEM (optional)
  want_assertions_signed boolean not null default true,
  want_response_signed boolean not null default true,
  nameid_format text,
  attr_email text not null default 'email',
  attr_name text not null default 'displayName',
  attr_groups text not null default 'groups',
  clock_skew_sec int not null default 180,
  role_map jsonb not null default '{}'::jsonb,
  vault_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- SCIM tokens + groups ----------
create table if not exists sync_scim_tokens(
  id uuid primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  name text,
  token_hash text not null,
  created_by uuid references sync_users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false,
  revoked_at timestamptz
);
create unique index if not exists idx_scim_token_hash_unique on sync_scim_tokens(token_hash);
create index if not exists idx_scim_tokens_org on sync_scim_tokens(org_id);

create table if not exists sync_scim_groups(
  id uuid primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  display_name text not null,
  external_id text,
  mapping jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_scim_groups_org_name_unique on sync_scim_groups(org_id, lower(display_name));

create table if not exists sync_scim_group_members(
  group_id uuid not null references sync_scim_groups(id) on delete cascade,
  user_id uuid not null references sync_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(group_id, user_id)
);

-- ---------- WebAuthn (hardware-backed attestation) ----------
create table if not exists sync_webauthn_creds(
  id bigserial primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  user_id uuid not null references sync_users(id) on delete cascade,
  device_id text,
  credential_id_b64url text not null,
  public_key_b64 text not null,
  counter bigint not null default 0,
  fmt text,
  aaguid text,
  attestation jsonb,
  transports jsonb,
  is_platform boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  compromised boolean not null default false
);
create unique index if not exists idx_webauthn_cred_unique on sync_webauthn_creds(org_id, credential_id_b64url);
create index if not exists idx_webauthn_org_user on sync_webauthn_creds(org_id, user_id);


create table if not exists sync_webauthn_challenges(
  id uuid primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  user_id uuid not null references sync_users(id) on delete cascade,
  type text not null,
  challenge_b64url text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_webauthn_chal_org_user on sync_webauthn_challenges(org_id, user_id);

-- ---------- WORM audit: anchors + immutability guards ----------
create table if not exists sync_audit_anchors(
  id bigserial primary key,
  org_id uuid not null references sync_orgs(id) on delete cascade,
  day date not null,
  root_hash text not null,
  alg text not null,
  key_id text,
  signature_b64 text not null,
  created_at timestamptz not null default now(),
  unique(org_id, day)
);

-- Prevent UPDATE/DELETE on sync_audit at SQL level (append-only)
create or replace function sync_audit_no_update_delete() returns trigger as $$
begin
  raise exception 'sync_audit is append-only (WORM)';
end;
$$ language plpgsql;

drop trigger if exists trg_sync_audit_no_ud on sync_audit;
create trigger trg_sync_audit_no_ud
  before update or delete on sync_audit
  for each row execute function sync_audit_no_update_delete();

commit;
