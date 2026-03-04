import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { getOrgRole } from "./_shared/rbac";

const VALID_WS_ROLES = new Set(["editor", "viewer"]);

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const orgRole = await getOrgRole(u.org_id, u.user_id);
  if (!orgRole || !["owner", "admin"].includes(orgRole)) {
    return json(403, { error: "Forbidden: owner/admin required." });
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const wsId = String(body.ws_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "").trim().toLowerCase();

  if (!wsId || !email) return json(400, { error: "Missing ws_id or email." });

  const ws = await q("select org_id from workspaces where id=$1", [wsId]);
  if (!ws.rows.length) return json(404, { error: "Workspace not found." });
  if (ws.rows[0].org_id !== u.org_id) return forbid();

  const target = await q(
    `select u.id, u.email
     from users u
     join org_memberships m on m.user_id=u.id and m.org_id=$1
     where lower(u.email)=lower($2)
     limit 1`,
    [u.org_id, email]
  );
  if (!target.rows.length) return json(404, { error: "Target user is not in this organization." });

  const targetUserId = target.rows[0].id;

  if (role === "remove") {
    await q("delete from workspace_memberships where ws_id=$1 and user_id=$2", [wsId, targetUserId]);
    await audit(u.email, u.org_id, wsId, "ws.member.remove", { email });
    return json(200, { ok: true, removed: true });
  }

  if (!VALID_WS_ROLES.has(role)) {
    return json(400, { error: "Invalid role. Use editor, viewer, or remove." });
  }

  await q(
    `insert into workspace_memberships(ws_id, user_id, role, created_by)
     values($1,$2,$3,$4)
     on conflict (ws_id, user_id) do update set role=excluded.role`,
    [wsId, targetUserId, role, u.user_id]
  );

  await audit(u.email, u.org_id, wsId, "ws.member.set", { email, role });
  return json(200, { ok: true, email, role });
};
