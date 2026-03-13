import { audit } from "./_shared/audit";
import {
  contractorErrorResponse,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { csvEscape, getSummaryBundle, safeDate, safeUuid } from "./_shared/contractor-income";

export default async (request: Request, context: any) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { "Content-Type": "application/json" } });
    }

    const scope = await resolveContractorAdminScope();
    const url = new URL(request.url);
    const contractorSubmissionId = safeUuid(url.searchParams.get("contractor_submission_id"));
    const start = safeDate(url.searchParams.get("start"));
    const end = safeDate(url.searchParams.get("end"));

    if (!contractorSubmissionId) return new Response(JSON.stringify({ error: "Missing contractor_submission_id." }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (!start || !end) return new Response(JSON.stringify({ error: "Missing start or end date." }), { status: 400, headers: { "Content-Type": "application/json" } });

    const bundle = await getSummaryBundle(contractorSubmissionId, scope.orgId, start, end);
    await audit(admin.actor, scope.orgId, bundle.contractor.ws_id || null, "contractor.finance.export", {
      contractor_submission_id: contractorSubmissionId,
      mission_id: bundle.contractor.mission_id || null,
      period_start: start,
      period_end: end,
      digest: bundle.digest,
    });

    const lines = [] as string[];
    lines.push(["section", "contractor_id", "contractor_name", "entry_date", "name", "type", "reference", "gross", "fees", "net", "expense_amount", "deductible_percent", "category", "verification_status", "notes", "proof_url"].join(","));

    for (const row of bundle.income || []) {
      lines.push(
        [
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
          row.proof_url || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    for (const row of bundle.expenses || []) {
      lines.push(
        [
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
          row.proof_url || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    lines.push("");
    lines.push(["summary_key", "summary_value"].join(","));
    Object.entries(bundle.totals || {}).forEach(([key, value]) => lines.push([csvEscape(key), csvEscape(value)].join(",")));
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
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to export contractor financial records.");
  }
};