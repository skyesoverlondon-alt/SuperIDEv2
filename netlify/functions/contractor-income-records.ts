import {
  contractorErrorResponse,
  contractorJson,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { getSummaryBundle, safeDate, safeUuid } from "./_shared/contractor-income";

export default async (request: Request, context: any) => {
  try {
    await requireContractorAdmin(request, context);
    if (request.method !== "GET") {
      return contractorJson(405, { error: "Method not allowed." });
    }

    const scope = await resolveContractorAdminScope();
    const url = new URL(request.url);
    const contractorSubmissionId = safeUuid(url.searchParams.get("contractor_submission_id"));
    const start = safeDate(url.searchParams.get("start"));
    const end = safeDate(url.searchParams.get("end"));

    if (!contractorSubmissionId) return contractorJson(400, { error: "Missing contractor_submission_id." });
    if (!start || !end) return contractorJson(400, { error: "Missing start or end date." });

    const bundle = await getSummaryBundle(contractorSubmissionId, scope.orgId, start, end);
    return contractorJson(200, { ok: true, ...bundle });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to fetch contractor financial records.");
  }
};