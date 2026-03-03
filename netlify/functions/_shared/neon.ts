import { must } from "./env";

/**
 * Execute a SQL query against the Neon serverless database via the
 * HTTP endpoint.  The NEON_DATABASE_URL environment variable must
 * be set to a valid Neon SQL-over-HTTP endpoint.  Returns the
 * parsed JSON result which includes a 'rows' array.
 */
export async function q(sql: string, params: any[] = []) {
  const url = must("NEON_DATABASE_URL");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error: ${text}`);
  }
  return res.json() as Promise<{ rows: any[] }>;
}