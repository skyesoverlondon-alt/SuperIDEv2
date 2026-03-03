/*
 * Simple Neon client for the Cloudflare Worker.  This module
 * exposes a single helper `q()` which executes SQL over HTTP
 * against a Neon Database endpoint.  The database URL is
 * expected to be provided via the `NEON_DATABASE_URL` secret on
 * the Worker environment.  Queries return an object with a
 * `rows` array on success or throw on failure.  Note that this
 * helper does no caching or connection pooling—it issues a
 * POST request for every invocation.
 */

export async function q(env: any, sql: string, params: any[] = []) {
  const url = env.NEON_DATABASE_URL;
  if (!url) throw new Error("Missing NEON_DATABASE_URL in Worker secrets.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error: ${text}`);
  }
  return (await res.json()) as { rows: any[] };
}