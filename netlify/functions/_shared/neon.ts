import { must } from "./env";

function toHttpSqlEndpoint(url: string): { endpoint: string; headers: Record<string, string> } {
  if (/^https?:\/\//i.test(url)) {
    return {
      endpoint: url,
      headers: { "Content-Type": "application/json" },
    };
  }

  if (/^postgres(ql)?:\/\//i.test(url)) {
    const parsed = new URL(url);
    const endpoint = `https://${parsed.host}/sql`;
    return {
      endpoint,
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": url,
      },
    };
  }

  throw new Error("NEON_DATABASE_URL must be an https SQL endpoint or postgres connection string.");
}

/**
 * Execute a SQL query against the Neon serverless database via the
 * HTTP endpoint.  The NEON_DATABASE_URL environment variable must
 * be set to a valid Neon SQL-over-HTTP endpoint.  Returns the
 * parsed JSON result which includes a 'rows' array.
 */
export async function q(sql: string, params: any[] = []) {
  const url = must("NEON_DATABASE_URL");
  const target = toHttpSqlEndpoint(url);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error: ${text}`);
  }
  return res.json() as Promise<{ rows: any[] }>;
}