import { q } from "./neon";

export type OrgPlanTier = "base" | "scaling" | "executive" | "corporate" | "enterprise";

export type OrgSeatSummary = {
  org_id: string;
  org_name: string;
  plan_tier: OrgPlanTier;
  seat_limit: number | null;
  active_members: number;
  pending_invites: number;
  seats_reserved: number;
  seats_available: number | null;
  allow_personal_key_override: boolean;
};

const PLAN_SEAT_LIMITS: Record<Exclude<OrgPlanTier, "enterprise">, number> = {
  base: 2,
  scaling: 20,
  executive: 100,
  corporate: 250,
};

export async function ensureOrgSeatColumns() {
  await q("alter table if exists orgs add column if not exists plan_tier text not null default 'base'", []);
  await q("alter table if exists orgs add column if not exists seat_limit integer", []);
  await q(
    "alter table if exists orgs add column if not exists allow_personal_key_override boolean not null default false",
    []
  );
}

export function normalizeOrgPlanTier(value: unknown): OrgPlanTier {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "scaling") return "scaling";
  if (normalized === "executive") return "executive";
  if (normalized === "corporate") return "corporate";
  if (normalized === "enterprise") return "enterprise";
  return "base";
}

export function getPlanSeatLimit(planTier: OrgPlanTier): number | null {
  if (planTier === "enterprise") return null;
  return PLAN_SEAT_LIMITS[planTier];
}

export async function getOrgSeatSummary(orgId: string): Promise<OrgSeatSummary | null> {
  await ensureOrgSeatColumns();

  const org = await q(
    `select id, name, coalesce(nullif(plan_tier, ''), 'base') as plan_tier, seat_limit, allow_personal_key_override
     from orgs
     where id=$1
     limit 1`,
    [orgId]
  );
  if (!org.rows.length) return null;

  const counts = await q(
    `select
       (select count(*)::int from org_memberships where org_id=$1) as active_members,
       (select count(*)::int from org_invites where org_id=$1 and status='pending' and expires_at > now()) as pending_invites`,
    [orgId]
  );

  const planTier = normalizeOrgPlanTier(org.rows[0].plan_tier);
  const explicitSeatLimit = org.rows[0].seat_limit;
  const seatLimit = explicitSeatLimit == null ? getPlanSeatLimit(planTier) : Number(explicitSeatLimit);
  const activeMembers = Number(counts.rows[0]?.active_members || 0);
  const pendingInvites = Number(counts.rows[0]?.pending_invites || 0);
  const seatsReserved = activeMembers + pendingInvites;

  return {
    org_id: org.rows[0].id,
    org_name: org.rows[0].name,
    plan_tier: planTier,
    seat_limit: seatLimit,
    active_members: activeMembers,
    pending_invites: pendingInvites,
    seats_reserved: seatsReserved,
    seats_available: seatLimit == null ? null : Math.max(seatLimit - seatsReserved, 0),
    allow_personal_key_override: Boolean(org.rows[0].allow_personal_key_override),
  };
}

export async function assertOrgSeatCapacity(orgId: string, seatsRequested = 1): Promise<OrgSeatSummary> {
  const summary = await getOrgSeatSummary(orgId);
  if (!summary) {
    const error = new Error("Organization not found.") as Error & { code?: string };
    error.code = "org_not_found";
    throw error;
  }
  if (summary.seat_limit == null) return summary;
  if (summary.seats_reserved + seatsRequested > summary.seat_limit) {
    const error = new Error("Seat limit reached.") as Error & { code?: string; seatSummary?: OrgSeatSummary };
    error.code = "seat_limit_reached";
    error.seatSummary = summary;
    throw error;
  }
  return summary;
}

function workspaceRoleForOrgRole(role: string): "editor" | "viewer" {
  return role === "viewer" ? "viewer" : "editor";
}

export async function ensurePrimaryWorkspace(
  orgId: string,
  userId: string,
  role: string,
  preferredName = "Primary Workspace"
) {
  const existing = await q(
    `select id, org_id, name, created_at, updated_at
     from workspaces
     where org_id=$1
     order by created_at asc
     limit 1`,
    [orgId]
  );

  const workspace = existing.rows.length
    ? existing.rows[0]
    : (
        await q(
          `insert into workspaces(org_id, name, files_json)
           values($1,$2,$3::jsonb)
           returning id, org_id, name, created_at, updated_at`,
          [orgId, preferredName, "[]"]
        )
      ).rows[0];

  await q(
    `insert into workspace_memberships(ws_id, user_id, role, created_by)
     values($1,$2,$3,$4)
     on conflict (ws_id, user_id) do update set role=excluded.role`,
    [workspace.id, userId, workspaceRoleForOrgRole(role), userId]
  );

  return workspace;
}