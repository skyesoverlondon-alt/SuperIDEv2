import { q } from "./neon";
import { canWriteWorkspace, getOrgRole } from "./rbac";

export type MissionStatus = "draft" | "active" | "blocked" | "completed" | "archived";
export type MissionPriority = "low" | "medium" | "high" | "critical";
export type MissionCollaboratorRole = "owner" | "collaborator" | "viewer";

export type MissionRow = {
  id: string;
  org_id: string;
  ws_id: string | null;
  title: string;
  status: MissionStatus;
  priority: MissionPriority;
  owner_user_id: string | null;
  goals_json: unknown;
  linked_apps_json: unknown;
  variables_json: unknown;
  entitlement_snapshot: unknown;
  created_at: string;
  updated_at: string;
};

const ALLOWED_STATUSES = new Set<MissionStatus>(["draft", "active", "blocked", "completed", "archived"]);
const ALLOWED_PRIORITIES = new Set<MissionPriority>(["low", "medium", "high", "critical"]);
const ALLOWED_COLLABORATOR_ROLES = new Set<MissionCollaboratorRole>(["owner", "collaborator", "viewer"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampString(value: unknown, maxLength: number) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}

export function isUuidLike(value: unknown) {
  return UUID_RE.test(String(value || "").trim());
}

export function clampList(input: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(input)) return [] as string[];
  return input
    .map((item) => clampString(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeMissionStatus(input: unknown, fallback: MissionStatus) {
  const next = clampString(input, 32).toLowerCase() as MissionStatus;
  return ALLOWED_STATUSES.has(next) ? next : fallback;
}

export function normalizeMissionPriority(input: unknown, fallback: MissionPriority) {
  const next = clampString(input, 32).toLowerCase() as MissionPriority;
  return ALLOWED_PRIORITIES.has(next) ? next : fallback;
}

export function normalizeCollaboratorRole(input: unknown, fallback: MissionCollaboratorRole = "collaborator") {
  const next = clampString(input, 32).toLowerCase() as MissionCollaboratorRole;
  return ALLOWED_COLLABORATOR_ROLES.has(next) ? next : fallback;
}

export function normalizeObject(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Record<string, unknown>;
  return { ...(input as Record<string, unknown>) };
}

export function readMissionNote(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return clampString((input as Record<string, unknown>).note, 4000);
}

export async function loadMission(orgId: string, missionId: string) {
  const result = await q(
    `select id, org_id, ws_id, title, status, priority, owner_user_id,
            goals_json, linked_apps_json, variables_json, entitlement_snapshot,
            created_at, updated_at
       from missions
      where id=$1 and org_id=$2
      limit 1`,
    [missionId, orgId]
  );
  return (result.rows[0] as MissionRow | undefined) || null;
}

export async function canWriteMission(orgId: string, userId: string, wsId: string | null) {
  if (wsId) return canWriteWorkspace(orgId, userId, wsId);
  const orgRole = await getOrgRole(orgId, userId);
  return orgRole === "owner" || orgRole === "admin" || orgRole === "member";
}

export async function touchMission(missionId: string) {
  await q("update missions set updated_at=now() where id=$1", [missionId]);
}
