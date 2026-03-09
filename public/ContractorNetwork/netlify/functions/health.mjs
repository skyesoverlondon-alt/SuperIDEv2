import { getSql } from "./_lib/neon.mjs";
import { ok, serverError } from "./_lib/resp.mjs";
export default async (req, context) => {
  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 as one`;
    return ok({ ok: true, build: process.env.DEPLOY_ID || process.env.COMMIT_REF || "n/a", db: rows?.[0]?.one === 1 });
  } catch (e) {
    return serverError("Health check failed", { ok: false, detail: e.message || String(e) });
  }
};
