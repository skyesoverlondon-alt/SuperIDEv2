const crypto = require("node:crypto");
const { json, readBody, requirePost, requireField, normalizeFiles, fetchJson } = require("./shared");

function sha1Hex(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

exports.handler = async (event) => {
  const gate = requirePost(event);
  if (gate) return gate;

  try {
    const body = readBody(event);
    const token = requireField(body, "token", "Netlify token");
    const siteId = requireField(body, "siteId", "Netlify site ID");
    const title = String(body.title || `SkyShip Command deploy · ${new Date().toISOString()}`);
    const files = normalizeFiles(body.files);

    const fingerprints = {};
    const byteMap = new Map();
    for (const file of files) {
      const bytes = Buffer.from(file.contentBase64, "base64");
      byteMap.set(`/${file.path}`,
        bytes
      );
      fingerprints[`/${file.path}`] = sha1Hex(bytes);
    }

    const deploy = await fetchJson(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: fingerprints,
        draft: false,
        async: true,
        title,
      }),
    });

    const deployId = deploy.id;
    const required = Array.isArray(deploy.required) ? deploy.required : [];

    for (const path of required) {
      const bytes = byteMap.get(path);
      if (!bytes) continue;
      const upload = await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files${path}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: bytes,
      });
      if (!upload.ok) {
        throw new Error(`Netlify upload failed for ${path}.`);
      }
    }

    return json(200, {
      ok: true,
      deploy_id: deployId,
      file_count: files.length,
      required_uploads: required.length,
      url: deploy.deploy_ssl_url || deploy.deploy_url || null,
      site_id: siteId,
    });
  } catch (error) {
    return json(500, { error: error.message || "Netlify deploy failed." });
  }
};
