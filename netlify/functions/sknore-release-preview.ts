import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";
import { buildSknoreReleasePlan } from "./_shared/sknore";

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

  const wsId = String(body.ws_id || "").trim();
  const rawFiles = Array.isArray(body.files) ? body.files : undefined;

  if (!wsId) return json(400, { error: "Missing ws_id." });

  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });

  const releasePlan = await buildSknoreReleasePlan(u.org_id, wsId, rawFiles);

  const scoped = await q(
    `select updated_at
       from app_records
      where org_id=$1 and app='SKNorePolicy' and ws_id=$2
      order by updated_at desc
      limit 1`,
    [u.org_id, wsId]
  );

  const orgWide = !scoped.rows.length
    ? await q(
        `select updated_at
           from app_records
          where org_id=$1 and app='SKNorePolicy' and ws_id is null
          order by updated_at desc
          limit 1`,
        [u.org_id]
      )
    : { rows: [] as any[] };

  const scope = scoped.rows.length ? "workspace" : orgWide.rows.length ? "org" : "workspace";
  const updatedAt = scoped.rows[0]?.updated_at || orgWide.rows[0]?.updated_at || null;

  return json(200, {
    ok: true,
    ws_id: wsId,
    workspace_name: releasePlan.workspaceName,
    scope,
    updated_at: updatedAt,
    source: Array.isArray(rawFiles) ? "client-files" : "workspace",
    sknore: {
      included_count: releasePlan.releaseFiles.length,
      blocked_count: releasePlan.blockedPaths.length,
      total_count: releasePlan.files.length,
      blocked_paths: releasePlan.blockedPaths,
      patterns_count: releasePlan.patterns.length,
    },
  });
};