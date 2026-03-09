import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace, canWriteWorkspace } from "./_shared/rbac";
import { json } from "./_shared/response";
import { audit } from "./_shared/audit";
import { emitSovereignEvent } from "./_shared/sovereign-events";
import { readCorrelationId } from "./_shared/correlation";

function parseLimit(raw: string | undefined) {
  const n = Number(raw || 12);
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

function clampList(input: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(input)) return [] as string[];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => (item.length > maxLength ? item.slice(0, maxLength) : item));
}

export const handler = async (event: any) => {
  const method = String(event?.httpMethod || "GET").toUpperCase();
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  if (method === "GET") {
    const params = event?.queryStringParameters || {};
    const wsId = String(params.ws_id || "").trim();
    const status = String(params.status || "").trim().toLowerCase();
    const limit = parseLimit(params.limit);

    if (wsId) {
      const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
      if (!allowed) return json(403, { error: "Workspace read denied." });
    }

    const clauses = ["m.org_id=$1"];
    const args: any[] = [u.org_id];
    let idx = 2;

    if (wsId) {
      clauses.push(`m.ws_id=$${idx++}`);
      args.push(wsId);
    }
    if (status) {
      clauses.push(`m.status=$${idx++}`);
      args.push(status);
    }

    args.push(limit);
    const result = await q(
      `select m.id, m.ws_id, m.title, m.status, m.priority, m.owner_user_id,
              m.goals_json, m.linked_apps_json, m.variables_json, m.entitlement_snapshot,
              m.created_at, m.updated_at,
              coalesce(mc.collaborator_count, 0) as collaborator_count,
              coalesce(ma.asset_count, 0) as asset_count
         from missions m
         left join (
           select mission_id, count(*)::int as collaborator_count
             from mission_collaborators
            group by mission_id
         ) mc on mc.mission_id = m.id
         left join (
           select mission_id, count(*)::int as asset_count
             from mission_assets
            group by mission_id
         ) ma on ma.mission_id = m.id
        where ${clauses.join(" and ")}
        order by m.updated_at desc
        limit $${idx}`,
      args
    );

    return json(200, { ok: true, items: result.rows });
  }

  if (method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const title = String(body.title || "").trim();
  const wsId = String(body.ws_id || "").trim();
  const status = String(body.status || "active").trim().toLowerCase();
  const priority = String(body.priority || "medium").trim().toLowerCase();
  const goals = clampList(body.goals, 10, 240);
  const linkedApps = clampList(body.linked_apps, 12, 80);
  const note = String(body.note || "").trim();
  const correlationId = readCorrelationId(event);

  if (!title) return json(400, { error: "Missing title." });
  if (wsId) {
    const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace write denied." });
  }

  const allowedStatuses = new Set(["draft", "active", "blocked", "completed", "archived"]);
  const allowedPriorities = new Set(["low", "medium", "high", "critical"]);
  const normalizedStatus = allowedStatuses.has(status) ? status : "active";
  const normalizedPriority = allowedPriorities.has(priority) ? priority : "medium";

  const inserted = await q(
    `insert into missions(
       org_id, ws_id, title, status, priority, owner_user_id,
       goals_json, linked_apps_json, variables_json, entitlement_snapshot
     )
     values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
     returning id, created_at, updated_at`,
    [
      u.org_id,
      wsId || null,
      title,
      normalizedStatus,
      normalizedPriority,
      u.user_id,
      JSON.stringify(goals),
      JSON.stringify(linkedApps),
      JSON.stringify(note ? { note } : {}),
      JSON.stringify({ issued_by: u.email, created_at: new Date().toISOString() }),
    ]
  );

  const missionId = inserted.rows[0]?.id || null;
  if (missionId) {
    await q(
      `insert into mission_collaborators(mission_id, user_id, email, role, added_by)
       values($1,$2,$3,'owner',$4)
       on conflict do nothing`,
      [missionId, u.user_id, u.email, u.user_id]
    );
  }

  await audit(u.email, u.org_id, wsId || null, "mission.create", {
    mission_id: missionId,
    title,
    status: normalizedStatus,
    priority: normalizedPriority,
    goals_count: goals.length,
    linked_apps: linkedApps,
    correlation_id: correlationId || null,
  });

  await emitSovereignEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId: wsId || null,
    missionId,
    eventType: "mission.created",
    sourceApp: "SkyeTasks",
    sourceRoute: "/api/missions",
    subjectKind: "mission",
    subjectId: String(missionId || ""),
    severity: "info",
    summary: `Mission created: ${title}`,
    correlationId,
    payload: {
      title,
      status: normalizedStatus,
      priority: normalizedPriority,
      goals,
      linked_apps: linkedApps,
      note: note || null,
    },
  });

  return json(200, {
    ok: true,
    id: missionId,
    title,
    ws_id: wsId || null,
    status: normalizedStatus,
    priority: normalizedPriority,
    created_at: inserted.rows[0]?.created_at || null,
    updated_at: inserted.rows[0]?.updated_at || null,
  });
};