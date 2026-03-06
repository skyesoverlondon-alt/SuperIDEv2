import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { canReadWorkspace } from "./_shared/rbac";

type WorkspaceFileRow = {
  path: string;
  content: string;
};

function sanitizeFiles(value: unknown): WorkspaceFileRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry as Partial<WorkspaceFileRow>;
      const path = String(row.path || "").trim().replace(/^\/+/, "");
      const content = typeof row.content === "string" ? row.content : "";
      if (!path) return null;
      return { path, content };
    })
    .filter((row): row is WorkspaceFileRow => Boolean(row));
}

export const handler = async (event: any) => {
  const user = await requireUser(event);
  if (!user) return forbid();

  const id = String(event.queryStringParameters?.id || "").trim();
  if (!id) return json(400, { error: "Missing id." });

  const workspace = await q(
    "select id,org_id,files_json,updated_at from workspaces where id=$1",
    [id]
  );
  if (!workspace.rows.length) return json(404, { error: "Not found." });
  if (workspace.rows[0].org_id !== user.org_id) return forbid();

  const canRead = await canReadWorkspace(user.org_id as string, user.user_id, id);
  if (!canRead) return json(403, { error: "Forbidden: no workspace access." });

  const files = sanitizeFiles(workspace.rows[0].files_json);
  const tree = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({ path: file.path, size: file.content.length }));

  return json(200, {
    files: tree,
    revision: workspace.rows[0].updated_at || null,
  });
};
