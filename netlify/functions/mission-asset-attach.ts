import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { readCorrelationId } from "./_shared/correlation";
import { canWriteMission, clampString, isUuidLike, loadMission, normalizeObject } from "./_shared/mission-control";
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
  const sourceApp = clampString(body.source_app, 80);
  const assetKind = clampString(body.asset_kind, 80);
  const assetId = clampString(body.asset_id, 160);
  const title = clampString(body.title, 200);
  const detail = normalizeObject(body.detail);

  if (!missionId) return json(400, { error: "Missing mission_id." });
  if (!isUuidLike(missionId)) return json(400, { error: "Invalid mission_id." });
  if (!assetKind) return json(400, { error: "Missing asset_kind." });
  if (!assetId) return json(400, { error: "Missing asset_id." });

  const mission = await loadMission(u.org_id, missionId);
  if (!mission) return json(404, { error: "Mission not found." });

  const allowed = await canWriteMission(u.org_id, u.user_id, mission.ws_id || null);
  if (!allowed) return json(403, { error: "Mission write denied." });

  const saved = await q(
    `insert into mission_assets(mission_id, source_app, asset_kind, asset_id, title, detail, attached_by)
     values($1,$2,$3,$4,$5,$6::jsonb,$7)
     on conflict (mission_id, asset_id)
     do update set
       source_app=excluded.source_app,
       asset_kind=excluded.asset_kind,
       title=excluded.title,
       detail=excluded.detail,
       attached_by=excluded.attached_by
     returning id, mission_id, source_app, asset_kind, asset_id, title, detail, created_at`,
    [missionId, sourceApp || null, assetKind, assetId, title || null, JSON.stringify(detail), u.user_id]
  );

  await q("update missions set updated_at=now() where id=$1", [missionId]);

  const correlationId = readCorrelationId(event);
  const item = saved.rows[0] || {};

  await audit(u.email, u.org_id, mission.ws_id || null, "mission.asset.attach", {
    mission_id: missionId,
    asset_id: assetId,
    asset_kind: assetKind,
    source_app: sourceApp || null,
    correlation_id: correlationId || null,
  });

  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId: mission.ws_id || null,
    missionId,
    eventType: "mission.asset.attached",
    sourceApp: "SkyeTasks",
    sourceRoute: "/api/mission-asset-attach",
    subjectKind: "mission_asset",
    subjectId: assetId,
    severity: "info",
    summary: `Mission asset attached: ${title || assetId}`,
    correlationId,
    payload: {
      mission_id: missionId,
      source_app: sourceApp || null,
      asset_kind: assetKind,
      asset_id: assetId,
      title: title || null,
      detail,
    },
  });

  return json(200, { ok: true, item });
};
