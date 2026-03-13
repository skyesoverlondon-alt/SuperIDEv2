import { getSql } from "./_lib/neon.mjs";
import { requireAdmin } from "./_lib/auth.mjs";
import { ok, badRequest, serverError } from "./_lib/resp.mjs";
import { clampString, clampMoney, safeUrl, safeDate, safeUuid, getContractorHeader } from "./_lib/contractor-income.mjs";

export default async (req, context) => {
  try {
    await requireAdmin(context, req);
    if (req.method !== "POST") return badRequest("Method not allowed");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

    const contractor_submission_id = safeUuid(body.contractor_submission_id);
    const kind = clampString(body.kind, 20).toLowerCase();
    const entry_date = safeDate(body.entry_date);
    const notes = clampString(body.notes, 3000);
    const proof_url = safeUrl(body.proof_url);
    const verification_status = clampString(body.verification_status, 40) || "unreviewed";
    const verification_notes = clampString(body.verification_notes, 1000);
    const created_by = clampString(body.created_by, 120) || "admin";

    if (!contractor_submission_id) return badRequest("Missing contractor_submission_id");
    if (!["income","expense"].includes(kind)) return badRequest("kind must be income or expense");
    if (!entry_date) return badRequest("Missing or invalid entry_date");

    const sql = getSql();
    const contractor = await getContractorHeader(sql, contractor_submission_id);
    if (!contractor) return badRequest("Contractor not found");

    if (kind === "income") {
      const source_name = clampString(body.source_name, 160);
      const source_type = clampString(body.source_type, 80) || "manual";
      const reference_code = clampString(body.reference_code, 120);
      const gross_amount = clampMoney(body.gross_amount);
      const fee_amount = clampMoney(body.fee_amount);
      const net_amount = body.net_amount != null ? clampMoney(body.net_amount) : clampMoney(gross_amount - fee_amount);
      const category = clampString(body.category, 80) || "general";
      if (!source_name) return badRequest("Missing source_name");

      const rows = await sql`
        INSERT INTO contractor_income_entries (
          contractor_submission_id, entry_date, source_name, source_type,
          reference_code, gross_amount, fee_amount, net_amount,
          category, notes, proof_url, verification_status, verification_notes, created_by
        ) VALUES (
          ${contractor_submission_id}, ${entry_date}, ${source_name}, ${source_type},
          ${reference_code || null}, ${gross_amount}, ${fee_amount}, ${net_amount},
          ${category}, ${notes || ""}, ${proof_url || null}, ${verification_status}, ${verification_notes || ""}, ${created_by}
        )
        RETURNING *
      `;

      return ok({ ok: true, kind, row: rows?.[0] || null, contractor });
    }

    const vendor_name = clampString(body.vendor_name, 160);
    const category = clampString(body.category, 80) || "general";
    const amount = clampMoney(body.amount);
    const deductible_percent = clampMoney(body.deductible_percent == null ? 100 : body.deductible_percent);
    if (!vendor_name) return badRequest("Missing vendor_name");

    const rows = await sql`
      INSERT INTO contractor_expense_entries (
        contractor_submission_id, entry_date, vendor_name, category,
        amount, deductible_percent, notes, proof_url, verification_status, verification_notes, created_by
      ) VALUES (
        ${contractor_submission_id}, ${entry_date}, ${vendor_name}, ${category},
        ${amount}, ${deductible_percent}, ${notes || ""}, ${proof_url || null}, ${verification_status}, ${verification_notes || ""}, ${created_by}
      )
      RETURNING *
    `;

    return ok({ ok: true, kind, row: rows?.[0] || null, contractor });
  } catch (e) {
    return serverError("Failed to create contractor financial record", { detail: e.message || String(e) });
  }
};
