import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";
import { json } from "./_shared/response";

function parseLimit(raw: string | undefined) {
  const n = Number(raw || 8);
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const sourceApp = String(params.source_app || "").trim();
  const limit = parseLimit(params.limit);

  if (wsId) {
    const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace read denied." });
  }

  const clauses = ["org_id=$1"];
  const args: any[] = [u.org_id];
  let idx = 2;

  if (wsId) {
    clauses.push(`ws_id=$${idx++}`);
    args.push(wsId);
  }
  if (sourceApp) {
    clauses.push(`source_app=$${idx++}`);
    args.push(sourceApp);
  }

  args.push(limit);
  const rows = await q(
    `select id, occurred_at, ws_id, mission_id, event_type, event_family, source_app,
            source_route, actor, subject_kind, subject_id, severity, correlation_id,
            summary, payload
       from sovereign_events
      where ${clauses.join(" and ")}
      order by occurred_at desc
      limit $${idx}`,
    args
  );

  return json(200, { ok: true, items: rows.rows });
};