import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { canReadWorkspace, canWriteWorkspace } from "./_shared/rbac";

type WorkspaceFileRow = {
  path: string;
  content: string;
};

function sanitizePath(value: unknown): string {
  return String(value || "").trim().replace(/^\/+/, "");
}

function sanitizeFiles(value: unknown): WorkspaceFileRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry as Partial<WorkspaceFileRow>;
      const path = sanitizePath(row.path);
      const content = typeof row.content === "string" ? row.content : "";
      if (!path) return null;
      return { path, content };
    })
    .filter((row): row is WorkspaceFileRow => Boolean(row));
}

export const handler = async (event: any) => {
  const user = await requireUser(event);
  if (!user) return forbid();

  const method = String(event.httpMethod || "GET").toUpperCase();
  const id = sanitizePath(event.queryStringParameters?.id);
  const queryPath = sanitizePath(event.queryStringParameters?.path);

  if (!id) return json(400, { error: "Missing id." });

  const workspace = await q(
    "select id,org_id,files_json,updated_at from workspaces where id=$1",
    [id]
  );
  if (!workspace.rows.length) return json(404, { error: "Not found." });
  if (workspace.rows[0].org_id !== user.org_id) return forbid();

  if (method === "GET") {
    const canRead = await canReadWorkspace(user.org_id as string, user.user_id, id);
    if (!canRead) return json(403, { error: "Forbidden: no workspace access." });
    if (!queryPath) return json(400, { error: "Missing path." });

    const files = sanitizeFiles(workspace.rows[0].files_json);
    const match = files.find((file) => file.path === queryPath);
    if (!match) return json(404, { error: "File not found." });

    return json(200, {
      file: {
        path: match.path,
        content: match.content,
      },
      revision: workspace.rows[0].updated_at || null,
    });
  }

  if (method === "PUT") {
    const canWrite = await canWriteWorkspace(user.org_id as string, user.user_id, id);
    if (!canWrite) return json(403, { error: "Forbidden: read-only workspace access." });

    const body = JSON.parse(event.body || "{}");
    const filePath = sanitizePath(body.path || queryPath);
    const content = typeof body.content === "string" ? body.content : "";
    const expectedRevision = String(body.expected_revision || "").trim();
    const force = Boolean(body.force);

    if (!filePath) return json(400, { error: "Missing path." });

    const currentRevision = workspace.rows[0].updated_at || null;
    if (!force && expectedRevision && currentRevision && expectedRevision !== currentRevision) {
      return json(409, {
        error: "Conflict: workspace changed on server.",
        conflict: {
          expected_revision: expectedRevision,
          current_revision: currentRevision,
        },
      });
    }

    const files = sanitizeFiles(workspace.rows[0].files_json);
    let found = false;
    const nextFiles = files.map((file) => {
      if (file.path !== filePath) return file;
      found = true;
      return { path: filePath, content };
    });
    if (!found) nextFiles.push({ path: filePath, content });

    const write = await q(
      "update workspaces set files_json=$1::jsonb, updated_at=now() where id=$2 returning updated_at",
      [JSON.stringify(nextFiles), id]
    );

    await audit(user.email, user.org_id, id, "ws.file.save", { path: filePath, size: content.length });

    return json(200, {
      ok: true,
      file: { path: filePath, content },
      revision: write.rows[0]?.updated_at || null,
    });
  }

  return json(405, { error: "Method not allowed." });
};
