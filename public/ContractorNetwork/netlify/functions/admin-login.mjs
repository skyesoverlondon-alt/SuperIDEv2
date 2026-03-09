import { getSql } from "./_lib/neon.mjs";
import { ok, badRequest, unauthorized, serverError } from "./_lib/resp.mjs";
import { signAdminJWT } from "./_lib/auth.mjs";
export default async (req, context) => {
  try {
    if (req.method !== "POST") return badRequest("Method not allowed");
    const body = await req.json().catch(() => ({}));
    const password = String(body.password || "");
    const expected = String(process.env.ADMIN_PASSWORD || "");
    if (!expected) return serverError("ADMIN_PASSWORD not set");
    if (!password || password !== expected) return unauthorized("Invalid password");
    try { const sql = getSql(); await sql`SELECT 1 as one`; } catch {}
    const secret = String(process.env.ADMIN_JWT_SECRET || "");
    if (!secret) return serverError("ADMIN_JWT_SECRET not set");
    const token = await signAdminJWT({ role: "admin", sub: "sol-admin" }, { secret, expiresInSec: 60 * 60 * 12 });
    return ok({ ok: true, token });
  } catch (e) {
    return serverError("Login error", { detail: e.message || String(e) });
  }
};
