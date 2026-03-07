import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { canReadWorkspace } from "./_shared/rbac";

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
  const recordId = String(body.record_id || "").trim();

  if (!wsId || !recordId) {
    return json(400, { error: "Missing ws_id or record_id." });
  }

  const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace read denied." });

  const rowResult = await q(
    `select id, title, payload, updated_at
       from app_records
      where id=$1
        and org_id=$2
        and ws_id=$3
        and app='SkyeDrive'
      limit 1`,
    [recordId, u.org_id, wsId]
  );

  const row = rowResult.rows[0];
  if (!row) return json(404, { error: "SkyeDrive source not found." });
  if (String(row?.payload?.kind || "") !== "workspace-source") {
    return json(400, { error: "Selected SkyeDrive record is not a workspace source." });
  }

  const files = Array.isArray(row?.payload?.files)
    ? row.payload.files
        .map((file: any) => ({
          path: String(file?.path || "").replace(/^\/+/, ""),
          content: typeof file?.content === "string" ? file.content : "",
        }))
        .filter((file: any) => file.path)
    : [];

  if (!files.length) {
    return json(400, { error: "Selected SkyeDrive source does not contain files." });
  }

  await q(
    `insert into integrations(user_id, skyedrive_ws_id, skyedrive_record_id, skyedrive_title)
     values($1,$2,$3,$4)
     on conflict(user_id) do update
       set skyedrive_ws_id=excluded.skyedrive_ws_id,
           skyedrive_record_id=excluded.skyedrive_record_id,
           skyedrive_title=excluded.skyedrive_title,
           updated_at=now()`,
    [u.user_id, wsId, row.id, row.title]
  );

  await audit(u.email, u.org_id, wsId, "skyedrive.source.open", {
    record_id: row.id,
    title: row.title,
    files: files.length,
  });

  return json(200, {
    ok: true,
    record_id: row.id,
    title: row.title,
    updated_at: row.updated_at,
    files,
  });
};