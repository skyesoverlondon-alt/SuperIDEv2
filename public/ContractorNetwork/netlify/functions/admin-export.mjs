import { getSql } from "./_lib/neon.mjs";
import { requireAdmin } from "./_lib/auth.mjs";

function csvEscape(v){
  const s = String(v ?? "");
  const needs = /[",\n]/.test(s);
  const out = s.replace(/"/g,'""');
  return needs ? `"${out}"` : out;
}

export default async (req, context) => {
  try {
    await requireAdmin(context, req);

    const sql = getSql();
    const rows = await sql`
      SELECT
        id, created_at, full_name, business_name, email, phone,
        coverage, availability, lanes, service_summary, proof_link,
        entity_type, licenses, status, admin_notes, tags, verified, dispatched
      FROM contractor_submissions
      ORDER BY created_at DESC
      LIMIT 5000
    `;

    const header = [
      "id","created_at","full_name","business_name","email","phone",
      "coverage","availability","lanes","service_summary","proof_link",
      "entity_type","licenses","status","admin_notes","tags","verified","dispatched"
    ];

    const lines = [];
    lines.push(header.join(","));
    for (const r of (rows || [])) {
      const lanes = Array.isArray(r.lanes) ? r.lanes : (typeof r.lanes === "string" ? JSON.parse(r.lanes || "[]") : (r.lanes || []));
      const tags = r.tags || [];
      const rec = { ...r, lanes: JSON.stringify(lanes), tags: JSON.stringify(tags) };
      lines.push(header.map(k => csvEscape(rec[k])).join(","));
    }

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"skyes-contractors-submissions.csv\"",
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    const msg = e.message || String(e);
    const status = msg.includes("allowlisted") ? 403 : (msg.includes("authorization") ? 401 : 500);
    return new Response(JSON.stringify({ error: msg }), { status, headers: {"Content-Type":"application/json"}});
  }
};
