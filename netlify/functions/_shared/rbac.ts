import { q } from "./neon";

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type WorkspaceRole = "editor" | "viewer";

export async function getOrgRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const r = await q("select role from org_memberships where org_id=$1 and user_id=$2 limit 1", [orgId, userId]);
  return (r.rows[0]?.role as OrgRole | undefined) || null;
}

export async function getWorkspaceRole(wsId: string, userId: string): Promise<WorkspaceRole | null> {
  const r = await q("select role from workspace_memberships where ws_id=$1 and user_id=$2 limit 1", [wsId, userId]);
  return (r.rows[0]?.role as WorkspaceRole | undefined) || null;
}

export async function canReadWorkspace(orgId: string, userId: string, wsId: string): Promise<boolean> {
  const orgRole = await getOrgRole(orgId, userId);
  if (!orgRole) return false;
  if (orgRole === "owner" || orgRole === "admin") return true;

  const wsRole = await getWorkspaceRole(wsId, userId);
  if (wsRole) return true;

  const c = await q("select count(*)::int as c from workspace_memberships where ws_id=$1", [wsId]);
  const hasScopedMemberships = Number(c.rows[0]?.c || 0) > 0;
  if (!hasScopedMemberships) return true;

  return false;
}

export async function canWriteWorkspace(orgId: string, userId: string, wsId: string): Promise<boolean> {
  const orgRole = await getOrgRole(orgId, userId);
  if (!orgRole) return false;
  if (orgRole === "owner" || orgRole === "admin") return true;

  const wsRole = await getWorkspaceRole(wsId, userId);
  if (wsRole === "editor") return true;
  if (wsRole === "viewer") return false;

  const c = await q("select count(*)::int as c from workspace_memberships where ws_id=$1", [wsId]);
  const hasScopedMemberships = Number(c.rows[0]?.c || 0) > 0;
  if (!hasScopedMemberships) return orgRole !== "viewer";

  return false;
}
