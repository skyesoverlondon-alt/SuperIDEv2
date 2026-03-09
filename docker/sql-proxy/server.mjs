import http from "node:http";
import { Pool } from "pg";

const port = Number(process.env.SQL_HTTP_PORT || 5540);
const connectionString = String(process.env.POSTGRES_URL || "").trim();

if (!connectionString) {
  throw new Error("POSTGRES_URL is required.");
}

const pool = new Pool({ connectionString });

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Neon-Connection-String",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Neon-Connection-String",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "POST" || req.url !== "/sql") {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const query = String(payload?.query || "").trim();
  const params = Array.isArray(payload?.params) ? payload.params : [];
  if (!query) {
    sendJson(res, 400, { error: "Missing query." });
    return;
  }

  try {
    const result = await pool.query(query, params);
    sendJson(res, 200, {
      rows: result.rows,
      rowCount: result.rowCount,
      command: result.command,
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`sql-http-proxy listening on ${port}`);
});