import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  if (String(event?.httpMethod || "GET").toUpperCase() !== "GET") {
    return json(405, { error: "Method not allowed." });
  }

  const u = await requireUser(event);
  if (!u) return forbid();

  const result = await q(
    `select github_repo,
            github_owner,
            github_branch,
            github_installation_id,
            skyedrive_ws_id,
            skyedrive_record_id,
            skyedrive_title,
            netlify_site_id,
            netlify_site_name,
            updated_at
       from integrations
      where user_id=$1
      limit 1`,
    [u.user_id]
  );

  const row = result.rows[0] || null;
  const updatedAt = row?.updated_at || null;
  const githubRepo = String(row?.github_repo || "").trim();
  const githubBranch = String(row?.github_branch || "main").trim() || "main";
  const githubInstallationId = row?.github_installation_id ? Number(row.github_installation_id) : null;
  const skyeDriveWsId = String(row?.skyedrive_ws_id || "").trim();
  const skyeDriveRecordId = String(row?.skyedrive_record_id || "").trim();
  const skyeDriveTitle = String(row?.skyedrive_title || "").trim();
  const netlifySiteId = String(row?.netlify_site_id || "").trim();
  const netlifySiteName = String(row?.netlify_site_name || "").trim() || null;

  return json(200, {
    github: {
      connected: Boolean(githubRepo && githubInstallationId),
      repo: githubRepo || null,
      owner: String(row?.github_owner || "").trim() || null,
      branch: githubRepo ? githubBranch : null,
      installation_id: githubInstallationId,
      updated_at: updatedAt,
    },
    skyedrive: {
      connected: Boolean(skyeDriveWsId && skyeDriveRecordId),
      ws_id: skyeDriveWsId || null,
      record_id: skyeDriveRecordId || null,
      title: skyeDriveTitle || null,
      updated_at: updatedAt,
    },
    netlify: {
      connected: Boolean(netlifySiteId),
      site_id: netlifySiteId || null,
      site_name: netlifySiteName,
      updated_at: updatedAt,
    },
  });
};