import { audit } from "./_shared/audit";
import {
  contractorErrorResponse,
  contractorJson,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import {
  clampMoney,
  clampString,
  getContractorHeader,
  safeDate,
  safeUrl,
  safeUuid,
} from "./_shared/contractor-income";
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
    const kind = clampString((body as any)?.kind, 20).toLowerCase();
    const entryDate = safeDate((body as any)?.entry_date);
    const notes = clampString((body as any)?.notes, 3000);
    const proofUrl = safeUrl((body as any)?.proof_url);
    const verificationStatus = clampString((body as any)?.verification_status, 40) || "unreviewed";
    const verificationNotes = clampString((body as any)?.verification_notes, 1000);
    const createdBy = clampString(admin.actor, 120) || "admin";

    if (!contractorSubmissionId) return contractorJson(400, { error: "Missing contractor_submission_id." });
    if (!entryDate) return contractorJson(400, { error: "Missing or invalid entry_date." });
    if (!["income", "expense"].includes(kind)) return contractorJson(400, { error: "kind must be income or expense." });

    const contractor = await getContractorHeader(contractorSubmissionId, scope.orgId);
    if (!contractor) return contractorJson(404, { error: "Contractor not found." });

    if (kind === "income") {
      const sourceName = clampString((body as any)?.source_name, 160);
      const sourceType = clampString((body as any)?.source_type, 80) || "manual";
      const referenceCode = clampString((body as any)?.reference_code, 120);
      const grossAmount = clampMoney((body as any)?.gross_amount);
      const feeAmount = clampMoney((body as any)?.fee_amount);
      const netAmount = (body as any)?.net_amount == null ? clampMoney(grossAmount - feeAmount) : clampMoney((body as any)?.net_amount);
      const category = clampString((body as any)?.category, 80) || "general";
      if (!sourceName) return contractorJson(400, { error: "Missing source_name." });

      const inserted = await q(
        `insert into contractor_income_entries(
           contractor_submission_id, entry_date, source_name, source_type,
           reference_code, gross_amount, fee_amount, net_amount,
           category, notes, proof_url, verification_status, verification_notes, created_by
         )
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning *`,
        [
          contractorSubmissionId,
          entryDate,
          sourceName,
          sourceType,
          referenceCode || null,
          grossAmount,
          feeAmount,
          netAmount,
          category,
          notes || "",
          proofUrl || null,
          verificationStatus,
          verificationNotes || "",
          createdBy,
        ]
      );

      const row = inserted.rows[0] || null;
      await audit(admin.actor, scope.orgId, contractor.ws_id || null, "contractor.finance.income.create", {
        contractor_submission_id: contractorSubmissionId,
        mission_id: contractor.mission_id || null,
        row_id: row?.id || null,
        gross_amount: grossAmount,
        fee_amount: feeAmount,
        net_amount: netAmount,
      });

      await emitSovereignEvent({
        actor: admin.actor,
        orgId: scope.orgId,
        wsId: contractor.ws_id || null,
        missionId: contractor.mission_id || null,
        eventType: "contractor.finance.income.created",
        sourceApp: "ContractorIncomeVerification",
        sourceRoute: "/api/contractor-income-record",
        subjectKind: "contractor_submission",
        subjectId: contractorSubmissionId,
        summary: `Income row added for ${contractor.full_name || contractor.email || contractorSubmissionId}`,
        payload: {
          row_id: row?.id || null,
          source_name: sourceName,
          category,
          gross_amount: grossAmount,
          fee_amount: feeAmount,
          net_amount: netAmount,
        },
      });

      return contractorJson(200, { ok: true, kind, row, contractor });
    }

    const vendorName = clampString((body as any)?.vendor_name, 160);
    const category = clampString((body as any)?.category, 80) || "general";
    const amount = clampMoney((body as any)?.amount);
    const deductiblePercent = clampMoney((body as any)?.deductible_percent == null ? 100 : (body as any)?.deductible_percent);
    if (!vendorName) return contractorJson(400, { error: "Missing vendor_name." });

    const inserted = await q(
      `insert into contractor_expense_entries(
         contractor_submission_id, entry_date, vendor_name, category,
         amount, deductible_percent, notes, proof_url, verification_status, verification_notes, created_by
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning *`,
      [
        contractorSubmissionId,
        entryDate,
        vendorName,
        category,
        amount,
        deductiblePercent,
        notes || "",
        proofUrl || null,
        verificationStatus,
        verificationNotes || "",
        createdBy,
      ]
    );

    const row = inserted.rows[0] || null;
    await audit(admin.actor, scope.orgId, contractor.ws_id || null, "contractor.finance.expense.create", {
      contractor_submission_id: contractorSubmissionId,
      mission_id: contractor.mission_id || null,
      row_id: row?.id || null,
      amount,
      deductible_percent: deductiblePercent,
      category,
    });

    await emitSovereignEvent({
      actor: admin.actor,
      orgId: scope.orgId,
      wsId: contractor.ws_id || null,
      missionId: contractor.mission_id || null,
      eventType: "contractor.finance.expense.created",
      sourceApp: "ContractorIncomeVerification",
      sourceRoute: "/api/contractor-income-record",
      subjectKind: "contractor_submission",
      subjectId: contractorSubmissionId,
      summary: `Expense row added for ${contractor.full_name || contractor.email || contractorSubmissionId}`,
      payload: {
        row_id: row?.id || null,
        vendor_name: vendorName,
        category,
        amount,
        deductible_percent: deductiblePercent,
      },
    });

    return contractorJson(200, { ok: true, kind, row, contractor });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to create contractor financial record.");
  }
};