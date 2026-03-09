import { q } from "./neon";
import { mintApiToken, tokenHash } from "./api_tokens";

type IssuedTokenSummary = {
  id: string;
  label: string;
  prefix: string;
  locked_email: string | null;
  scopes: string[];
  status: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

export type OrgKeyAssignmentSummary = {
  user_id: string;
  email: string;
  assigned_token: IssuedTokenSummary | null;
  personal_token: IssuedTokenSummary | null;
  effective_token: IssuedTokenSummary | null;
  effective_source: "personal" | "assigned" | "org_default" | "none";
};

export type OrgKeyPolicySummary = {
  org_id: string;
  allow_personal_key_override: boolean;
  default_token: IssuedTokenSummary | null;
  assignments: OrgKeyAssignmentSummary[];
};

const TTL_PRESETS_MINUTES: Record<string, number> = {
  test_2m: 2,
  "1h": 60,
  "5h": 5 * 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
  month: 30 * 24 * 60,
  quarter: 90 * 24 * 60,
  quarterly: 90 * 24 * 60,
  year: 365 * 24 * 60,
  annual: 365 * 24 * 60,
};

function mapToken(row: any): IssuedTokenSummary | null {
  if (!row?.id) return null;
  return {
    id: row.id,
    label: row.label || row.prefix || "token",
    prefix: row.prefix,
    locked_email: row.locked_email || null,
    scopes: Array.isArray(row.scopes_json) ? row.scopes_json.map(String) : ["generate"],
    status: row.status || "active",
    created_at: row.created_at,
    expires_at: row.expires_at || null,
    last_used_at: row.last_used_at || null,
  };
}

export async function ensureOrgKeyTables() {
  await q(
    `create table if not exists org_key_policies (
       org_id uuid primary key references orgs(id) on delete cascade,
       default_token_id uuid references api_tokens(id) on delete set null,
       updated_by uuid references users(id),
       updated_at timestamptz not null default now()
     )`,
    []
  );
  await q(
    `create table if not exists org_user_key_assignments (
       org_id uuid not null references orgs(id) on delete cascade,
       user_id uuid not null references users(id) on delete cascade,
       assigned_token_id uuid references api_tokens(id) on delete set null,
       personal_token_id uuid references api_tokens(id) on delete set null,
       assigned_by uuid references users(id),
       updated_at timestamptz not null default now(),
       primary key (org_id, user_id)
     )`,
    []
  );
  await q("create index if not exists idx_org_user_key_assignments_assigned on org_user_key_assignments(assigned_token_id)", []);
  await q("create index if not exists idx_org_user_key_assignments_personal on org_user_key_assignments(personal_token_id)", []);
}

function resolveTtlMinutes(ttlPreset?: string): number {
  const preset = String(ttlPreset || "quarter").trim().toLowerCase();
  return TTL_PRESETS_MINUTES[preset] || TTL_PRESETS_MINUTES.quarter;
}

export async function issueOrgScopedToken(options: {
  orgId: string;
  issuedByUserId: string | null;
  labelPrefix: string;
  index?: number;
  ttlPreset?: string;
  lockedEmail?: string | null;
  scopes?: string[];
}) {
  await ensureOrgKeyTables();
  const token = mintApiToken();
  const prefix = token.slice(0, 14);
  const label = `${String(options.labelPrefix || "token").slice(0, 64)}-${Math.max(1, Number(options.index || 1))}`;
  const scopes = Array.isArray(options.scopes) && options.scopes.length ? options.scopes : ["generate"];
  const ttlMinutes = resolveTtlMinutes(options.ttlPreset);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const inserted = await q(
    `insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     returning id, label, prefix, locked_email, scopes_json, status, created_at, expires_at, last_used_at`,
    [
      options.orgId,
      options.issuedByUserId,
      label,
      tokenHash(token),
      prefix,
      expiresAt,
      options.lockedEmail || null,
      JSON.stringify(scopes),
    ]
  );
  return {
    token,
    summary: mapToken(inserted.rows[0])!,
  };
}

export async function setOrgDefaultToken(orgId: string, tokenId: string, updatedBy: string | null) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_key_policies(org_id, default_token_id, updated_by, updated_at)
     values($1,$2,$3,now())
     on conflict (org_id)
     do update set default_token_id=excluded.default_token_id, updated_by=excluded.updated_by, updated_at=now()`,
    [orgId, tokenId, updatedBy]
  );
}

export async function clearOrgDefaultToken(orgId: string, updatedBy: string | null) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_key_policies(org_id, default_token_id, updated_by, updated_at)
     values($1,null,$2,now())
     on conflict (org_id)
     do update set default_token_id=null, updated_by=excluded.updated_by, updated_at=now()`,
    [orgId, updatedBy]
  );
}

export async function setAssignedUserToken(orgId: string, userId: string, tokenId: string, assignedBy: string | null) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, assigned_token_id, assigned_by, updated_at)
     values($1,$2,$3,$4,now())
     on conflict (org_id, user_id)
     do update set assigned_token_id=excluded.assigned_token_id, assigned_by=excluded.assigned_by, updated_at=now()`,
    [orgId, userId, tokenId, assignedBy]
  );
}

export async function clearAssignedUserToken(orgId: string, userId: string, assignedBy: string | null) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, assigned_token_id, assigned_by, updated_at)
     values($1,$2,null,$3,now())
     on conflict (org_id, user_id)
     do update set assigned_token_id=null, assigned_by=excluded.assigned_by, updated_at=now()`,
    [orgId, userId, assignedBy]
  );
}

export async function setPersonalOverrideToken(orgId: string, userId: string, tokenId: string) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, personal_token_id, updated_at)
     values($1,$2,$3,now())
     on conflict (org_id, user_id)
     do update set personal_token_id=excluded.personal_token_id, updated_at=now()`,
    [orgId, userId, tokenId]
  );
}

export async function clearPersonalOverrideToken(orgId: string, userId: string) {
  await ensureOrgKeyTables();
  await q(
    `insert into org_user_key_assignments(org_id, user_id, personal_token_id, updated_at)
     values($1,$2,null,now())
     on conflict (org_id, user_id)
     do update set personal_token_id=null, updated_at=now()`,
    [orgId, userId]
  );
}

export async function getOrgKeyPolicySummary(orgId: string): Promise<OrgKeyPolicySummary | null> {
  await ensureOrgKeyTables();
  const org = await q(
    `select o.id, o.allow_personal_key_override,
            p.default_token_id,
            t.id as default_id,
            t.label as default_label,
            t.prefix as default_prefix,
            t.locked_email as default_locked_email,
            t.scopes_json as default_scopes_json,
            t.status as default_status,
            t.created_at as default_created_at,
            t.expires_at as default_expires_at,
            t.last_used_at as default_last_used_at
     from orgs o
     left join org_key_policies p on p.org_id=o.id
     left join api_tokens t on t.id=p.default_token_id
     where o.id=$1
     limit 1`,
    [orgId]
  );
  if (!org.rows.length) return null;

  const assignments = await q(
    `select u.id as user_id,
            u.email,
            a.assigned_token_id,
            a.personal_token_id,
            at.id as assigned_id,
            at.label as assigned_label,
            at.prefix as assigned_prefix,
            at.locked_email as assigned_locked_email,
            at.scopes_json as assigned_scopes_json,
            at.status as assigned_status,
            at.created_at as assigned_created_at,
            at.expires_at as assigned_expires_at,
            at.last_used_at as assigned_last_used_at,
            pt.id as personal_id,
            pt.label as personal_label,
            pt.prefix as personal_prefix,
            pt.locked_email as personal_locked_email,
            pt.scopes_json as personal_scopes_json,
            pt.status as personal_status,
            pt.created_at as personal_created_at,
            pt.expires_at as personal_expires_at,
            pt.last_used_at as personal_last_used_at
     from org_memberships m
     join users u on u.id=m.user_id
     left join org_user_key_assignments a on a.org_id=m.org_id and a.user_id=m.user_id
     left join api_tokens at on at.id=a.assigned_token_id
     left join api_tokens pt on pt.id=a.personal_token_id
     where m.org_id=$1
     order by lower(u.email) asc`,
    [orgId]
  );

  const defaultToken = mapToken({
    id: org.rows[0].default_id,
    label: org.rows[0].default_label,
    prefix: org.rows[0].default_prefix,
    locked_email: org.rows[0].default_locked_email,
    scopes_json: org.rows[0].default_scopes_json,
    status: org.rows[0].default_status,
    created_at: org.rows[0].default_created_at,
    expires_at: org.rows[0].default_expires_at,
    last_used_at: org.rows[0].default_last_used_at,
  });
  const allowPersonal = Boolean(org.rows[0].allow_personal_key_override);

  return {
    org_id: org.rows[0].id,
    allow_personal_key_override: allowPersonal,
    default_token: defaultToken,
    assignments: assignments.rows.map((row) => {
      const assignedToken = mapToken({
        id: row.assigned_id,
        label: row.assigned_label,
        prefix: row.assigned_prefix,
        locked_email: row.assigned_locked_email,
        scopes_json: row.assigned_scopes_json,
        status: row.assigned_status,
        created_at: row.assigned_created_at,
        expires_at: row.assigned_expires_at,
        last_used_at: row.assigned_last_used_at,
      });
      const personalToken = mapToken({
        id: row.personal_id,
        label: row.personal_label,
        prefix: row.personal_prefix,
        locked_email: row.personal_locked_email,
        scopes_json: row.personal_scopes_json,
        status: row.personal_status,
        created_at: row.personal_created_at,
        expires_at: row.personal_expires_at,
        last_used_at: row.personal_last_used_at,
      });
      const effectiveToken = allowPersonal && personalToken
        ? personalToken
        : assignedToken || defaultToken || null;
      const effectiveSource = allowPersonal && personalToken
        ? "personal"
        : assignedToken
          ? "assigned"
          : defaultToken
            ? "org_default"
            : "none";
      return {
        user_id: row.user_id,
        email: row.email,
        assigned_token: assignedToken,
        personal_token: personalToken,
        effective_token: effectiveToken,
        effective_source: effectiveSource,
      } as OrgKeyAssignmentSummary;
    }),
  };
}