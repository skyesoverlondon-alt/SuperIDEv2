import { getSql } from "./_lib/neon.mjs";
import { ok, badRequest, serverError } from "./_lib/resp.mjs";
import { requireAdmin } from "./_lib/auth.mjs";
import { clampString, clampArray, normalizeStatus } from "./_lib/validate.mjs";

export default async (req, context) => {
  try {
    const admin = await requireAdmin(context, req);
    if (req.method !== "PATCH") return badRequest("Method not allowed");

    const id = (context?.params?.splat || "").trim();
    if (!id) return badRequest("Missing submission id");

    const body = await req.json().catch(() => ({}));
    const admin_notes = clampString(body.admin_notes, 8000);
    const tags = clampArray(body.tags, 20, 48);
    const status = normalizeStatus(body.status);

    const sql = getSql();

    await sql`
      UPDATE contractor_submissions
      SET admin_notes = ${admin_notes}, tags = ${tags}, status = ${status}
      WHERE id = ${id}::uuid
    `;

    await sql`
      INSERT INTO admin_audit (actor, action, subject_id, metadata)
      VALUES (${admin.actor}, ${"update_submission"}, ${id}::uuid, ${JSON.stringify({ status, tagsCount: tags.length })})
    `;

    return ok({ ok: true, id });
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes("authorization")) return new Response(JSON.stringify({ error: msg }), { status: 401, headers: {"Content-Type":"application/json"}});
    return serverError("Update failed", { detail: msg });
  }
};
