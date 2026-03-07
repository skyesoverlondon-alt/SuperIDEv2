import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { canWriteWorkspace } from "./_shared/rbac";
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
  const title = String(body.title || "").trim();
  const note = String(body.note || body.message || "").trim();
  const sourceKind = String(body.source_kind || "workspace-save").trim() || "workspace-save";
  const sourceName = String(body.source_name || "").trim();

  if (!wsId) return json(400, { error: "Missing ws_id." });

  const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace write denied." });

  const incomingFiles = Array.isArray(body.files) ? body.files : null;

  const releasePlan = await buildSknoreReleasePlan(u.org_id, wsId, incomingFiles || undefined);
  if (!releasePlan.files.length) {
    return json(400, { error: "Workspace has no files to push into SkyeDrive." });
  }
  if (!releasePlan.releaseFiles.length) {
    return json(400, { error: "All workspace files are SKNore-protected. Nothing can be pushed into SkyeDrive." });
  }

  const snapshotTitle = title || `${releasePlan.workspaceName || "SkyDex Workspace"} · SkyeDrive Snapshot`;
  const payload = {
    kind: "workspace-source",
    source: "SkyDex4.6",
    source_kind: sourceKind,
    source_name: sourceName || null,
    note: note || null,
    workspace_name: releasePlan.workspaceName || null,
    workspace_revision: new Date().toISOString(),
    file_count: releasePlan.releaseFiles.length,
    files: releasePlan.releaseFiles,
    sknore: {
      patterns_count: releasePlan.patterns.length,
      blocked_paths: releasePlan.blockedPaths,
    },
  };

  const inserted = await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,$2,'SkyeDrive',$3,$4::jsonb,$5)
     returning id, updated_at`,
    [u.org_id, wsId, snapshotTitle, JSON.stringify(payload), u.user_id]
  );

  const recordId = inserted.rows[0]?.id || null;

  await q(
    `insert into integrations(user_id, skyedrive_ws_id, skyedrive_record_id, skyedrive_title)
     values($1,$2,$3,$4)
     on conflict(user_id) do update
       set skyedrive_ws_id=excluded.skyedrive_ws_id,
           skyedrive_record_id=excluded.skyedrive_record_id,
           skyedrive_title=excluded.skyedrive_title,
           updated_at=now()`,
    [u.user_id, wsId, recordId, snapshotTitle]
  );

  await audit(u.email, u.org_id, wsId, "skyedrive.push.ok", {
    record_id: recordId,
    title: snapshotTitle,
    files: releasePlan.releaseFiles.length,
    source_kind: sourceKind,
    source_name: sourceName || null,
    note: note || null,
    sknore_blocked: releasePlan.blockedPaths.length,
  });

  return json(200, {
    ok: true,
    record_id: recordId,
    title: snapshotTitle,
    file_count: releasePlan.releaseFiles.length,
    source_kind: sourceKind,
    source_name: sourceName || null,
    updated_at: inserted.rows[0]?.updated_at || null,
    sknore: {
      included_count: releasePlan.releaseFiles.length,
      blocked_count: releasePlan.blockedPaths.length,
      blocked_paths: releasePlan.blockedPaths,
      patterns_count: releasePlan.patterns.length,
    },
  });
};