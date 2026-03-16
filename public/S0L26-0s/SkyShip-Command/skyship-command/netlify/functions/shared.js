exports.json = function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body ?? {}),
  };
};

exports.readBody = function readBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return {};
  }
};

exports.requirePost = function requirePost(event) {
  if (event.httpMethod !== "POST") {
    return exports.json(405, { error: "Method not allowed." });
  }
  return null;
};

exports.requireField = function requireField(body, field, label) {
  const value = body?.[field];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label || field} is required.`);
  }
  return String(value).trim();
};

exports.normalizeFiles = function normalizeFiles(files) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error("No files were provided.");
  }
  const clean = [];
  for (const file of files) {
    const path = String(file?.path || "").replace(/^\/+/, "").trim();
    const contentBase64 = String(file?.contentBase64 || "").trim();
    if (!path || !contentBase64) continue;
    if (path.includes("..")) throw new Error(`Illegal path: ${path}`);
    clean.push({
      path,
      contentBase64,
      size: Number(file?.size || 0),
      originalPath: file?.originalPath || path,
    });
  }
  if (!clean.length) throw new Error("No valid files were provided.");
  return clean;
};

exports.fetchJson = async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.errors?.[0]?.message ||
      data?.result?.errors?.[0]?.message ||
      `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
};
