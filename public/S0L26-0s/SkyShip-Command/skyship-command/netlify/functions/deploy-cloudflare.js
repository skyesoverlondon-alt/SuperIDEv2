const { json, readBody, requirePost, requireField, fetchJson } = require("./shared");

exports.handler = async (event) => {
  const gate = requirePost(event);
  if (gate) return gate;

  try {
    const body = readBody(event);
    const token = requireField(body, "token", "Cloudflare token");
    const accountId = requireField(body, "accountId", "Cloudflare account ID");
    const projectName = requireField(body, "projectName", "Cloudflare Pages project name");
    const branch = String(body.branch || "main").trim() || "main";
    const commitMessage = String(body.commitMessage || `SkyShip Command trigger · ${new Date().toISOString()}`);
    const commitHash = String(body.commitHash || "").trim() || `${Date.now()}`;

    const form = new FormData();
    form.append("branch", branch);
    form.append("commit_dirty", "false");
    form.append("commit_hash", commitHash);
    form.append("commit_message", commitMessage);

    const response = await fetchJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }
    );

    const result = response.result || response;
    return json(200, {
      ok: true,
      project_name: result.project_name || projectName,
      deployment_id: result.id,
      environment: result.environment || null,
      url: result.url || result.aliases?.[0] || null,
      branch,
      latest_stage: result.latest_stage?.status || null,
    });
  } catch (error) {
    return json(500, {
      error:
        error.message ||
        "Cloudflare deploy trigger failed. Make sure the Pages project already exists and is Git-connected.",
    });
  }
};
