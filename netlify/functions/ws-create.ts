import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "No org assigned." });
  const { name } = JSON.parse(event.body || "{}");
  const wsName = name || "Workspace";
  const r = await q(
    "insert into workspaces(org_id,name,files_json) values($1,$2,$3::jsonb) returning id,org_id,name,created_at,updated_at",
    [u.org_id, wsName, "[]"]
  );
  await q(
    `insert into workspace_memberships(ws_id, user_id, role, created_by)
     values($1,$2,$3,$4)
     on conflict (ws_id, user_id) do update set role=excluded.role`,
    [r.rows[0].id, u.user_id, "editor", u.user_id]
  );
  await audit(u.email, u.org_id, r.rows[0].id, "ws.create", { name: wsName });
  return json(200, { ws: r.rows[0] });
};