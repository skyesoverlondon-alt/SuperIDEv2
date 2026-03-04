import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const wsId = String(event.queryStringParameters?.id || "").trim();
  if (!wsId) return json(400, { error: "Missing workspace id." });

  const ws = await q("select id, org_id, name from workspaces where id=$1", [wsId]);
  if (!ws.rows.length) return json(404, { error: "Workspace not found." });
  if (ws.rows[0].org_id !== u.org_id) return forbid();

  const canRead = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!canRead) return forbid();

  const members = await q(
    `select wm.user_id, u.email, wm.role, wm.created_at
     from workspace_memberships wm
     join users u on u.id = wm.user_id
     where wm.ws_id=$1
     order by wm.created_at asc`,
    [wsId]
  );

  return json(200, { ok: true, workspace: ws.rows[0], members: members.rows });
};
