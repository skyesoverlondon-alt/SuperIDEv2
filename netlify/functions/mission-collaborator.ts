import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { readCorrelationId } from "./_shared/correlation";
import {
  canWriteMission,
  clampString,
  isUuidLike,
  loadMission,
  normalizeCollaboratorRole,
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
  const email = clampString(body.email, 254).toLowerCase();
  const requestedUserId = clampString(body.user_id, 64);
  const role = normalizeCollaboratorRole(body.role);

  if (!missionId) return json(400, { error: "Missing mission_id." });
  if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
  if (!email && !requestedUserId) return json(400, { error: "Missing collaborator identity." });
  if (requestedUserId && !isUuidLike(requestedUserId)) return json(400, { error: "Invalid user_id." });

  const mission = await loadMission(u.org_id, missionId);
  if (!mission) return json(404, { error: "Mission not found." });

  const allowed = await canWriteMission(u.org_id, u.user_id, mission.ws_id || null);
  if (!allowed) return json(403, { error: "Mission write denied." });

  let resolvedUserId = requestedUserId || null;
  let resolvedEmail = email || null;

  if (requestedUserId) {
    const matchedUser = await q(
      `select id, email
         from users
        where id=$1 and org_id=$2
        limit 1`,
      [requestedUserId, u.org_id]
    );
    if (!matchedUser.rows.length) return json(404, { error: "Collaborator user not found in org." });
    resolvedUserId = matchedUser.rows[0]?.id || requestedUserId;
    resolvedEmail = String(matchedUser.rows[0]?.email || email || "").trim().toLowerCase() || null;
  } else if (email) {
    const matchedUser = await q(
      `select id, email
         from users
        where org_id=$1 and lower(email)=lower($2)
        limit 1`,
      [u.org_id, email]
    );
    if (matchedUser.rows.length) {
      resolvedUserId = matchedUser.rows[0]?.id || null;
      resolvedEmail = String(matchedUser.rows[0]?.email || email).trim().toLowerCase() || null;
    }
  }

  const existing = await q(
    `select id
       from mission_collaborators
      where mission_id=$1
        and (
          ($2::uuid is not null and user_id=$2::uuid)
          or ($3::text is not null and lower(email)=lower($3::text))
        )
      order by created_at asc
      limit 1`,
    [missionId, resolvedUserId, resolvedEmail]
  );

  let collaboratorId = String(existing.rows[0]?.id || "");
  if (collaboratorId) {
    await q(
      `update mission_collaborators
          set user_id=$2::uuid,
              email=$3,
              role=$4
        where id=$1`,
      [collaboratorId, resolvedUserId, resolvedEmail, role]
    );
  } else {
    const inserted = await q(
      `insert into mission_collaborators(mission_id, user_id, email, role, added_by)
       values($1,$2::uuid,$3,$4,$5)
       returning id`,
      [missionId, resolvedUserId, resolvedEmail, role, u.user_id]
    );
    collaboratorId = String(inserted.rows[0]?.id || "");
  }

  await q("update missions set updated_at=now() where id=$1", [missionId]);

  const correlationId = readCorrelationId(event);
  await audit(u.email, u.org_id, mission.ws_id || null, "mission.collaborator.attach", {
    mission_id: missionId,
    collaborator_id: collaboratorId,
    collaborator_user_id: resolvedUserId,
    collaborator_email: resolvedEmail,
    role,
    correlation_id: correlationId || null,
  });

  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId: mission.ws_id || null,
    missionId,
    eventType: "mission.collaborator.attached",
    sourceApp: "SkyeTasks",
    sourceRoute: "/api/mission-collaborator",
    subjectKind: "mission_collaborator",
    subjectId: collaboratorId || resolvedUserId || resolvedEmail || missionId,
    severity: "info",
    summary: `Mission collaborator attached: ${resolvedEmail || resolvedUserId || "collaborator"}`,
    correlationId,
    payload: {
      mission_id: missionId,
      collaborator_id: collaboratorId || null,
      user_id: resolvedUserId,
      email: resolvedEmail,
      role,
    },
  });

  return json(200, {
    ok: true,
    item: {
      id: collaboratorId || null,
      mission_id: missionId,
      user_id: resolvedUserId,
      email: resolvedEmail,
      role,
    },
  });
};
