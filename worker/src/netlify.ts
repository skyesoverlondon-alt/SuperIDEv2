/*
 * Netlify deploy helper for the Cloudflare Worker.  Provides a
 * function to create a deploy from a workspace using a vaulted
 * personal access token.  Deploys are created via the Netlify
 * Deploy API; files are hashed locally and uploaded only if
 * required.  See https://docs.netlify.com/api/get-started for
 * details.
 */

import { q } from "./neon";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Compute the SHA-1 hash of a Uint8Array and return it as a hex
 * string.  Uses WebCrypto.  Note: SHA-1 is required by the
 * Netlify Deploy API for file identifiers.
 */
async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", toArrayBuffer(bytes));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encode a string to a Uint8Array using UTF-8.
 */
function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Call the Netlify Deploy API with the given path, token and
 * method.  Throws on failure and returns parsed JSON on success.
 */
async function netlify(apiPath: string, token: string, method: string, body?: any): Promise<any> {
  const res = await fetch(`https://api.netlify.com/api/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.message || `Netlify API error (${res.status})`);
  }
  return data;
}

/**
 * Deploy the given workspace to a Netlify site.  Loads the
 * workspace files from Neon and computes a sha1 for each file.
 * Creates a deploy via the API, then uploads only the files
 * required by the deployment.  Returns the deploy ID, URL and
 * number of uploaded files.
 */
export async function netlifyDeployFromWorkspace(
  env: any,
  token: string,
  ws_id: string,
  site_id: string,
  title: string,
  filesOverride?: Array<{ path: string; content: string }>
): Promise<{ ok: true; deploy_id: string; url: string | null; required: number }> {
  const ws = Array.isArray(filesOverride)
    ? { rows: [{ files_json: filesOverride }] }
    : await q(env, "select files_json from workspaces where id=$1", [ws_id]);
  if (!ws.rows.length) throw new Error("Workspace not found.");
  const files: { path: string; content: string }[] = ws.rows[0].files_json || [];
  if (!files.length) throw new Error("Workspace is empty.");
  // Build sha map and bytes map
  const fileMap: Record<string, string> = {};
  const bytesMap: Record<string, Uint8Array> = {};
  for (const f of files) {
    if (!f.path || f.path.includes("..")) continue;
    const norm = f.path.startsWith("/") ? f.path : `/${f.path}`;
    const bytes = textBytes(f.content ?? "");
    bytesMap[norm] = bytes;
    fileMap[norm] = await sha1Hex(bytes);
  }
  // Create deploy (async) with file fingerprints
  const deploy = await netlify(`/sites/${site_id}/deploys`, token, "POST", {
    files: fileMap,
    draft: false,
    async: true,
    title,
  });
  const deploy_id: string = deploy.id;
  const required: string[] = deploy.required || [];
  // Upload required files
  for (const p of required) {
    const bytes = bytesMap[p];
    if (!bytes) continue;
    const up = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy_id}/files${p}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: toArrayBuffer(bytes),
    });
    if (!up.ok) {
      throw new Error(`Upload failed for ${p}: ${await up.text()}`);
    }
  }
  return {
    ok: true,
    deploy_id,
    url: deploy.deploy_ssl_url || deploy.deploy_url || null,
    required: required.length,
  };
}