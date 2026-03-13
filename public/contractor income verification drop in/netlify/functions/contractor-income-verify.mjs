import crypto from "node:crypto";
import { getSql } from "./_lib/neon.mjs";
import { requireAdmin } from "./_lib/auth.mjs";
import { ok, badRequest, serverError } from "./_lib/resp.mjs";
import { clampString, safeDate, safeUuid, getSummaryBundle } from "./_lib/contractor-income.mjs";

export default async (req, context) => {
  try {
    await requireAdmin(context, req);
    if (req.method !== "POST") return badRequest("Method not allowed");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

    const contractor_submission_id = safeUuid(body.contractor_submission_id);
    const period_start = safeDate(body.period_start);
    const period_end = safeDate(body.period_end);
    const status = clampString(body.status, 40) || "issued";
    const verification_tier = clampString(body.verification_tier, 80) || "company_verified";
    const issued_by_name = clampString(body.issued_by_name, 120) || "Skyes Over London";
    const issued_by_title = clampString(body.issued_by_title, 120) || "Chief Executive Officer";
    const company_name = clampString(body.company_name, 160) || "Skyes Over London";
    const company_email = clampString(body.company_email, 200) || "SkyesOverLondonLC@solenterprises.org";
    const company_phone = clampString(body.company_phone, 60) || "4804695416";
    const statement_text = clampString(body.statement_text, 5000) || "This verification packet reflects contractor activity documented and maintained within the Skyes Over London contractor network platform for the selected reporting window.";
    const packet_notes = clampString(body.packet_notes, 3000);

    if (!contractor_submission_id) return badRequest("Missing contractor_submission_id");
    if (!period_start || !period_end) return badRequest("Missing period_start or period_end");

    const bundle = await getSummaryBundle(contractor_submission_id, period_start, period_end);
    const packet_hash = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        contractor_submission_id,
        period_start,
        period_end,
        totals: bundle.totals,
        digest: bundle.digest,
        status,
        verification_tier,
        issued_by_name,
        company_name,
      }))
      .digest("hex");

    const sql = getSql();
    const rows = await sql`
      INSERT INTO contractor_verification_packets (
        contractor_submission_id, period_start, period_end,
        status, verification_tier, issued_by_name, issued_by_title,
        company_name, company_email, company_phone,
        statement_text, packet_notes, packet_hash
      ) VALUES (
        ${contractor_submission_id}, ${period_start}, ${period_end},
        ${status}, ${verification_tier}, ${issued_by_name}, ${issued_by_title},
        ${company_name}, ${company_email}, ${company_phone},
        ${statement_text}, ${packet_notes || ""}, ${packet_hash}
      )
      ON CONFLICT (contractor_submission_id, period_start, period_end)
      DO UPDATE SET
        status = EXCLUDED.status,
        verification_tier = EXCLUDED.verification_tier,
        issued_by_name = EXCLUDED.issued_by_name,
        issued_by_title = EXCLUDED.issued_by_title,
        company_name = EXCLUDED.company_name,
        company_email = EXCLUDED.company_email,
        company_phone = EXCLUDED.company_phone,
        statement_text = EXCLUDED.statement_text,
        packet_notes = EXCLUDED.packet_notes,
        packet_hash = EXCLUDED.packet_hash,
        updated_at = now()
      RETURNING *
    `;

    return ok({ ok: true, packet: rows?.[0] || null, totals: bundle.totals });
  } catch (e) {
    return serverError("Failed to verify contractor financial packet", { detail: e.message || String(e) });
  }
};
