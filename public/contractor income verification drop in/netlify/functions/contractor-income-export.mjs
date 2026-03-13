import { requireAdmin } from "./_lib/auth.mjs";
import { badRequest } from "./_lib/resp.mjs";
import { safeUuid, safeDate, getSummaryBundle, csvEscape } from "./_lib/contractor-income.mjs";

export default async (req, context) => {
  try {
    await requireAdmin(context, req);
    if (req.method !== "GET") return badRequest("Method not allowed");

    const url = new URL(req.url);
    const contractor_submission_id = safeUuid(url.searchParams.get("contractor_submission_id"));
    const start = safeDate(url.searchParams.get("start"));
    const end = safeDate(url.searchParams.get("end"));

    if (!contractor_submission_id) return badRequest("Missing contractor_submission_id");
    if (!start || !end) return badRequest("Missing start or end date");

    const bundle = await getSummaryBundle(contractor_submission_id, start, end);
    const lines = [];
    lines.push(["section","contractor_id","contractor_name","entry_date","name","type","reference","gross","fees","net","expense_amount","deductible_percent","category","verification_status","notes","proof_url"].join(","));

    for (const row of bundle.income || []) {
      lines.push([
        "income",
        bundle.contractor.id,
        bundle.contractor.full_name,
        row.entry_date,
        row.source_name,
        row.source_type,
        row.reference_code || "",
        row.gross_amount,
        row.fee_amount,
        row.net_amount,
        "",
        "",
        row.category || "",
        row.verification_status || "",
        row.notes || "",
        row.proof_url || ""
      ].map(csvEscape).join(","));
    }

    for (const row of bundle.expenses || []) {
      lines.push([
        "expense",
        bundle.contractor.id,
        bundle.contractor.full_name,
        row.entry_date,
        row.vendor_name,
        "expense",
        "",
        "",
        "",
        "",
        row.amount,
        row.deductible_percent,
        row.category || "",
        row.verification_status || "",
        row.notes || "",
        row.proof_url || ""
      ].map(csvEscape).join(","));
    }

    lines.push("");
    lines.push(["summary_key","summary_value"].join(","));
    Object.entries(bundle.totals || {}).forEach(([k, v]) => lines.push([csvEscape(k), csvEscape(v)].join(",")));
    lines.push([csvEscape("period_start"), csvEscape(bundle.period.start)].join(","));
    lines.push([csvEscape("period_end"), csvEscape(bundle.period.end)].join(","));
    lines.push([csvEscape("digest"), csvEscape(bundle.digest)].join(","));
    if (bundle.packet) {
      lines.push([csvEscape("packet_status"), csvEscape(bundle.packet.status || "")].join(","));
      lines.push([csvEscape("verification_tier"), csvEscape(bundle.packet.verification_tier || "")].join(","));
      lines.push([csvEscape("packet_hash"), csvEscape(bundle.packet.packet_hash || "")].join(","));
    }

    const filename = `contractor-income-export-${bundle.contractor.id}-${start}-to-${end}.csv`;
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    const msg = e.message || String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
