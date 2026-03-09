import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { readCorrelationId } from "./_shared/correlation";
import {
  canWriteMission,
  clampList,
  clampString,
  isUuidLike,
  loadMission,
  normalizeMissionPriority,
  normalizeMissionStatus,
  normalizeObject,
  readMissionNote,
} from "./_shared/mission-control";
import { q } from "./_shared/neon";
import { json } from "./_shared/response";
import { emitSovereignEvent } from "./_shared/sovereign-events";

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "POST").toUpperCase() !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const missionId = clampString(body.mission_id || body.id, 64);
  if (!missionId) return json(400, { error: "Missing mission_id." });
  if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });

  const mission = await loadMission(u.org_id, missionId);
  if (!mission) return json(404, { error: "Mission not found." });

  const allowed = await canWriteMission(u.org_id, u.user_id, mission.ws_id || null);
  if (!allowed) return json(403, { error: "Mission write denied." });

  const titleProvided = Object.prototype.hasOwnProperty.call(body, "title");
  const statusProvided = Object.prototype.hasOwnProperty.call(body, "status");
  const priorityProvided = Object.prototype.hasOwnProperty.call(body, "priority");
  const goalsProvided = Object.prototype.hasOwnProperty.call(body, "goals");
  const linkedAppsProvided = Object.prototype.hasOwnProperty.call(body, "linked_apps");
  const noteProvided = Object.prototype.hasOwnProperty.call(body, "note");
  const variablesProvided = Object.prototype.hasOwnProperty.call(body, "variables");

  if (!titleProvided && !statusProvided && !priorityProvided && !goalsProvided && !linkedAppsProvided && !noteProvided && !variablesProvided) {
    return json(400, { error: "No mission changes provided." });
  }

  const nextTitle = titleProvided ? clampString(body.title, 200) : mission.title;
  if (!nextTitle) return json(400, { error: "Mission title cannot be empty." });

  const nextStatus = statusProvided ? normalizeMissionStatus(body.status, mission.status) : mission.status;
  const nextPriority = priorityProvided ? normalizeMissionPriority(body.priority, mission.priority) : mission.priority;
  const nextGoals = goalsProvided ? clampList(body.goals, 10, 240) : Array.isArray(mission.goals_json) ? (mission.goals_json as string[]) : [];
  const nextLinkedApps = linkedAppsProvided ? clampList(body.linked_apps, 12, 80) : Array.isArray(mission.linked_apps_json) ? (mission.linked_apps_json as string[]) : [];
  const existingVariables = normalizeObject(mission.variables_json);
  const mergedVariables = {
    ...existingVariables,
    ...(variablesProvided ? normalizeObject(body.variables) : {}),
  } as Record<string, unknown>;
  if (noteProvided) {
    const note = clampString(body.note, 4000);
    if (note) mergedVariables.note = note;
    else delete mergedVariables.note;
  }

  const updated = await q(
    `update missions
        set title=$3,
            status=$4,
            priority=$5,
            goals_json=$6::jsonb,
            linked_apps_json=$7::jsonb,
            variables_json=$8::jsonb,
            updated_at=now()
      where id=$1 and org_id=$2
      returning id, ws_id, title, status, priority, goals_json, linked_apps_json, variables_json, updated_at`,
    [
      missionId,
      u.org_id,
      nextTitle,
      nextStatus,
      nextPriority,
      JSON.stringify(nextGoals),
      JSON.stringify(nextLinkedApps),
      JSON.stringify(mergedVariables),
    ]
  );

  const correlationId = readCorrelationId(event);
  const updatedMission = updated.rows[0] || {};
  const note = readMissionNote(mergedVariables);

  await audit(u.email, u.org_id, mission.ws_id || null, "mission.update", {
    mission_id: missionId,
    title: nextTitle,
    status: nextStatus,
    priority: nextPriority,
    goals_count: nextGoals.length,
    linked_apps: nextLinkedApps,
    correlation_id: correlationId || null,
  });

  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId: mission.ws_id || null,
    missionId,
    eventType: "mission.updated",
    sourceApp: "SkyeTasks",
    sourceRoute: "/api/mission-update",
    subjectKind: "mission",
    subjectId: missionId,
    severity: "info",
    summary: `Mission updated: ${nextTitle}`,
    correlationId,
    payload: {
      title: nextTitle,
      status: nextStatus,
      priority: nextPriority,
      goals: nextGoals,
      linked_apps: nextLinkedApps,
      note: note || null,
    },
  });

  return json(200, { ok: true, item: updatedMission });
};
