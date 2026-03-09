import {
  contractorErrorResponse,
  contractorJson,
  normalizeStatus,
  normalizeTags,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { audit } from "./_shared/audit";
import { q } from "./_shared/neon";
import { emitSovereignEvent } from "./_shared/sovereign-events";

export default async (request: Request, context: any) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "PATCH") {
      return contractorJson(405, { error: "Method not allowed." });
    }

    const submissionId = String(context?.params?.splat || "").trim();
    if (!submissionId) {
      return contractorJson(400, { error: "Missing submission id." });
    }

    const body = await request.json().catch(() => ({}));
    const adminNotes = String((body as any)?.admin_notes || "").trim().slice(0, 8000);
    const tags = normalizeTags((body as any)?.tags);
    const status = normalizeStatus((body as any)?.status);
    const scope = await resolveContractorAdminScope();

    const updated = await q(
      `update contractor_submissions
          set admin_notes=$3,
              tags=$4::text[],
              status=$5,
              updated_at=now(),
              last_contacted_at=case when $5 in ('approved','on_hold','rejected') then now() else last_contacted_at end
        where id=$1
          and org_id=$2
      returning id, org_id, ws_id, mission_id, full_name, email, status, tags, admin_notes`,
      [submissionId, scope.orgId, adminNotes, tags, status]
    );

    const row = updated.rows[0];
    if (!row) {
      return contractorJson(404, { error: "Submission not found." });
    }

    await audit(admin.actor, scope.orgId, row.ws_id || null, "contractor.submission.update", {
      submission_id: row.id,
      mission_id: row.mission_id || null,
      status: row.status,
      tags,
      mode: admin.mode,
    });

    await emitSovereignEvent({
      actor: admin.actor,
      orgId: scope.orgId,
      wsId: row.ws_id || null,
      missionId: row.mission_id || null,
      eventType: "contractor.submission.updated",
      sourceApp: "ContractorNetwork",
      sourceRoute: "/api/admin/submission",
      subjectKind: "contractor_submission",
      subjectId: String(row.id || submissionId),
      severity: status === "rejected" ? "warning" : "info",
      summary: `Contractor submission updated: ${row.full_name || row.email || submissionId}`,
      payload: {
        status: row.status,
        tags,
        admin_notes: row.admin_notes || "",
        admin_mode: admin.mode,
      },
    });

    return contractorJson(200, { ok: true, id: row.id, status: row.status, tags });
  } catch (error) {
    return contractorErrorResponse(error, "Submission update failed.");
  }
};
