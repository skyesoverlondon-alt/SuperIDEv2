import crypto from "crypto";
import { audit } from "./_shared/audit";
import {
  contractorErrorResponse,
  contractorJson,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { clampString, getSummaryBundle, safeDate, safeUuid } from "./_shared/contractor-income";
import { q } from "./_shared/neon";
import { emitSovereignEvent } from "./_shared/sovereign-events";

export default async (request: Request, context: any) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "POST") {
      return contractorJson(405, { error: "Method not allowed." });
    }

    const body = await request.json().catch(() => ({}));
    const scope = await resolveContractorAdminScope();
    const contractorSubmissionId = safeUuid((body as any)?.contractor_submission_id);
    const periodStart = safeDate((body as any)?.period_start);
    const periodEnd = safeDate((body as any)?.period_end);
    const status = clampString((body as any)?.status, 40) || "issued";
    const verificationTier = clampString((body as any)?.verification_tier, 80) || "company_verified";
    const issuedByName = clampString((body as any)?.issued_by_name, 120) || "Skyes Over London";
    const issuedByTitle = clampString((body as any)?.issued_by_title, 120) || "Chief Executive Officer";
    const companyName = clampString((body as any)?.company_name, 160) || "Skyes Over London";
    const companyEmail = clampString((body as any)?.company_email, 200) || "SkyesOverLondonLC@solenterprises.org";
    const companyPhone = clampString((body as any)?.company_phone, 60) || "4804695416";
    const statementText =
      clampString((body as any)?.statement_text, 5000) ||
      "This verification packet reflects contractor activity documented and maintained within the Skyes Over London contractor network platform for the selected reporting window.";
    const packetNotes = clampString((body as any)?.packet_notes, 3000);

    if (!contractorSubmissionId) return contractorJson(400, { error: "Missing contractor_submission_id." });
    if (!periodStart || !periodEnd) return contractorJson(400, { error: "Missing period_start or period_end." });

    const bundle = await getSummaryBundle(contractorSubmissionId, scope.orgId, periodStart, periodEnd);
    const packetHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          contractor_submission_id: contractorSubmissionId,
          period_start: periodStart,
          period_end: periodEnd,
          totals: bundle.totals,
          digest: bundle.digest,
          status,
          verification_tier: verificationTier,
          issued_by_name: issuedByName,
          company_name: companyName,
        })
      )
      .digest("hex");

    const result = await q(
      `insert into contractor_verification_packets(
         contractor_submission_id, period_start, period_end,
         status, verification_tier, issued_by_name, issued_by_title,
         company_name, company_email, company_phone,
         statement_text, packet_notes, packet_hash
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (contractor_submission_id, period_start, period_end)
       do update set
         status=excluded.status,
         verification_tier=excluded.verification_tier,
         issued_by_name=excluded.issued_by_name,
         issued_by_title=excluded.issued_by_title,
         company_name=excluded.company_name,
         company_email=excluded.company_email,
         company_phone=excluded.company_phone,
         statement_text=excluded.statement_text,
         packet_notes=excluded.packet_notes,
         packet_hash=excluded.packet_hash,
         updated_at=now()
       returning *`,
      [
        contractorSubmissionId,
        periodStart,
        periodEnd,
        status,
        verificationTier,
        issuedByName,
        issuedByTitle,
        companyName,
        companyEmail,
        companyPhone,
        statementText,
        packetNotes || "",
        packetHash,
      ]
    );

    const packet = result.rows[0] || null;
    await audit(admin.actor, scope.orgId, bundle.contractor.ws_id || null, "contractor.finance.packet.verify", {
      contractor_submission_id: contractorSubmissionId,
      mission_id: bundle.contractor.mission_id || null,
      period_start: periodStart,
      period_end: periodEnd,
      packet_hash: packetHash,
      status,
      verification_tier: verificationTier,
    });

    await emitSovereignEvent({
      actor: admin.actor,
      orgId: scope.orgId,
      wsId: bundle.contractor.ws_id || null,
      missionId: bundle.contractor.mission_id || null,
      eventType: "contractor.finance.packet.verified",
      sourceApp: "ContractorIncomeVerification",
      sourceRoute: "/api/contractor-income-verify",
      subjectKind: "contractor_submission",
      subjectId: contractorSubmissionId,
      summary: `Verification packet updated for ${bundle.contractor.full_name || bundle.contractor.email || contractorSubmissionId}`,
      payload: {
        packet_id: packet?.id || null,
        period_start: periodStart,
        period_end: periodEnd,
        packet_hash: packetHash,
        status,
        verification_tier: verificationTier,
      },
    });

    return contractorJson(200, { ok: true, packet, totals: bundle.totals });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to verify contractor financial packet.");
  }
};