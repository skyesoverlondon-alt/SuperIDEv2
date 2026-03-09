import {
  contractorErrorResponse,
  normalizeContractorLanes,
  normalizeContractorTags,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { q } from "./_shared/neon";

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, '""');
  return /[",\n]/.test(raw) ? `"${escaped}"` : escaped;
}

export default async (request: Request, context: any) => {
  try {
    await requireContractorAdmin(request, context);
    const scope = await resolveContractorAdminScope();
    const rows = await q(
      `select id, created_at, full_name, business_name, email, phone,
              coverage, availability, lanes, service_summary, proof_link,
              entity_type, licenses, status, admin_notes, tags, verified, dispatched,
              ws_id, mission_id, event_id
         from contractor_submissions
        where org_id=$1
        order by created_at desc
        limit 5000`,
      [scope.orgId]
    );

    const header = [
      "id",
      "created_at",
      "full_name",
      "business_name",
      "email",
      "phone",
      "coverage",
      "availability",
      "lanes",
      "service_summary",
      "proof_link",
      "entity_type",
      "licenses",
      "status",
      "admin_notes",
      "tags",
      "verified",
      "dispatched",
      "ws_id",
      "mission_id",
      "event_id",
    ];

    const lines = [header.join(",")];
    for (const row of rows.rows) {
      const record = {
        ...row,
        lanes: JSON.stringify(normalizeContractorLanes(row.lanes)),
        tags: JSON.stringify(normalizeContractorTags(row.tags)),
      } as Record<string, unknown>;
      lines.push(header.map((key) => csvEscape(record[key])).join(","));
    }

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="skyes-contractors-submissions.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractorErrorResponse(error, "Export failed.");
  }
};
