import { contractorErrorResponse, contractorHealthProbe, contractorJson, resolveContractorAdminScope } from "./_shared/contractor-admin";

export default async () => {
  try {
    const scope = await resolveContractorAdminScope();
    await contractorHealthProbe();
    return contractorJson(200, {
      ok: true,
      build: process.env.DEPLOY_ID || process.env.COMMIT_REF || "n/a",
      org_id: scope.orgId,
      ws_id: scope.wsId,
      mission_id: scope.missionId,
    });
  } catch (error) {
    return contractorErrorResponse(error, "Health check failed.");
  }
};
