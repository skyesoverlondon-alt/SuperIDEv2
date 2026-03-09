import { getSql } from "./_lib/neon.mjs";
import { ok } from "./_lib/resp.mjs";
import { requireAdmin } from "./_lib/auth.mjs";

function parseIntSafe(v, def=50, min=1, max=200){
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default async (req, context) => {
  try {
    await requireAdmin(context, req);

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "").trim();
    const q = (url.searchParams.get("q") || "").trim();
    const limit = parseIntSafe(url.searchParams.get("limit"), 100, 1, 200);

    const sql = getSql();
    const clauses = [];
    const params = [];
    let idx = 1;

    if (status) { clauses.push(`status = $${idx++}`); params.push(status); }
    if (q) {
      clauses.push(`(
        full_name ILIKE $${idx} OR
        email ILIKE $${idx} OR
        service_summary ILIKE $${idx} OR
        coverage ILIKE $${idx} OR
        business_name ILIKE $${idx}
      )`);
      params.push(`%${q}%`);
      idx++;
    }

    const where = clauses.length ? ("WHERE " + clauses.join(" AND ")) : "";
    const query = `
      SELECT
        id, created_at, full_name, email, business_name, phone, coverage, availability,
        lanes, service_summary, proof_link, entity_type, licenses,
        status, admin_notes, tags, verified, dispatched, last_contacted_at
      FROM contractor_submissions
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const rows = await sql.query(query, params);

    const ids = (rows || []).map(r => r.id);
    const filesMap = new Map();

    if (ids.length) {
      const f = await sql.query(
        `SELECT id, submission_id, filename, content_type, bytes, created_at
         FROM submission_files
         WHERE submission_id = ANY($1::uuid[])
         ORDER BY created_at DESC`,
        [ids]
      );
      for (const x of (f || [])) {
        const sid = x.submission_id;
        if (!filesMap.has(sid)) filesMap.set(sid, []);
        filesMap.get(sid).push({
          id: x.id,
          filename: x.filename,
          content_type: x.content_type,
          bytes: x.bytes,
          created_at: x.created_at
        });
      }
    }

    const items = (rows || []).map(r => ({
      ...r,
      lanes: Array.isArray(r.lanes) ? r.lanes : (typeof r.lanes === "string" ? JSON.parse(r.lanes || "[]") : (r.lanes || [])),
      tags: r.tags || [],
      files: filesMap.get(r.id) || []
    }));

    return ok({ ok: true, items });
  } catch (e) {
    const msg = e.message || String(e);
    const status = msg.includes("allowlisted") ? 403 : (msg.includes("authorization") ? 401 : 500);
    return new Response(JSON.stringify({ error: msg }), { status, headers: {"Content-Type":"application/json"}});
  }
};
