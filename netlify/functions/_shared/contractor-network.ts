import { q } from "./neon";
import { opt } from "./env";

export type ContractorIntakeTarget = {
  orgId: string;
  wsId: string | null;
  missionId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampString(value: unknown, maxLength: number) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}

export function clampArray(input: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(input)) return [] as string[];
  return input
    .map((item) => clampString(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

export function safeEmail(value: unknown) {
  const next = clampString(value, 254).toLowerCase();
  if (!next || !next.includes("@") || next.includes(" ")) return "";
  return next;
}

export function safePhone(value: unknown) {
  return clampString(value, 40).replace(/[^\d+\-() ]/g, "").slice(0, 40);
}

export function safeUrl(value: unknown) {
  const next = clampString(value, 500);
  if (!next) return "";
  try {
    const parsed = new URL(next);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function parseJsonList(value: unknown, limit: number) {
  if (Array.isArray(value)) return clampArray(value, limit, 80);
  const raw = String(value || "").trim();
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return clampArray(parsed, limit, 80);
  } catch {
    return [] as string[];
  }
}

export function safeFilename(value: unknown) {
  const next = clampString(value, 180) || "file";
  return next.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function isUuidLike(value: unknown) {
  return UUID_RE.test(String(value || "").trim());
}

export function readCorrelationIdFromHeaders(headers: Headers) {
  const candidates = [
    headers.get("x-correlation-id"),
    headers.get("X-Correlation-Id"),
    headers.get("x_correlation_id"),
  ];
  const value = clampString(candidates.find(Boolean), 128);
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
}

export async function resolveContractorIntakeTarget() {
  const orgId = clampString(opt("CONTRACTOR_NETWORK_ORG_ID"), 64);
  const wsId = clampString(opt("CONTRACTOR_NETWORK_WS_ID"), 64) || null;
  const missionId = clampString(opt("CONTRACTOR_NETWORK_MISSION_ID"), 64) || null;

  if (!orgId) {
    throw new Error("Contractor Network intake is not configured. Missing CONTRACTOR_NETWORK_ORG_ID.");
  }

  if (!isUuidLike(orgId)) {
    throw new Error("CONTRACTOR_NETWORK_ORG_ID must be a UUID.");
  }

  if (wsId) {
    if (!isUuidLike(wsId)) {
      throw new Error("CONTRACTOR_NETWORK_WS_ID must be a UUID.");
    }
    const ws = await q("select id from workspaces where id=$1 and org_id=$2 limit 1", [wsId, orgId]);
    if (!ws.rows.length) {
      throw new Error("CONTRACTOR_NETWORK_WS_ID does not belong to CONTRACTOR_NETWORK_ORG_ID.");
    }
  }

  if (missionId) {
    if (!isUuidLike(missionId)) {
      throw new Error("CONTRACTOR_NETWORK_MISSION_ID must be a UUID.");
    }
    const mission = await q(
      "select id, ws_id from missions where id=$1 and org_id=$2 limit 1",
      [missionId, orgId]
    );
    if (!mission.rows.length) {
      throw new Error("CONTRACTOR_NETWORK_MISSION_ID does not belong to CONTRACTOR_NETWORK_ORG_ID.");
    }
    return {
      orgId,
      wsId: wsId || mission.rows[0]?.ws_id || null,
      missionId,
    } satisfies ContractorIntakeTarget;
  }

  return { orgId, wsId, missionId: null } satisfies ContractorIntakeTarget;
}
