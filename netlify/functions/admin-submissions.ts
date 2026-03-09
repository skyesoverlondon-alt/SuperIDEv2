import {
  contractorErrorResponse,
  contractorJson,
  normalizeContractorLanes,
  normalizeContractorTags,
  readContractorQueryLimit,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { q } from "./_shared/neon";

export default async (request: Request, context: any) => {
  try {
    await requireContractorAdmin(request, context);
    const scope = await resolveContractorAdminScope();
    const url = new URL(request.url);
    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const term = String(url.searchParams.get("q") || "").trim();
    const limit = readContractorQueryLimit(url.searchParams.get("limit"), 100, 200);

    const clauses = ["org_id=$1"];
    const params: any[] = [scope.orgId];
    let idx = 2;

    if (status) {
      clauses.push(`status=$${idx++}`);
      params.push(status);
    }
    if (term) {
      clauses.push(`(
        full_name ilike $${idx}
        or email ilike $${idx}
        or service_summary ilike $${idx}
        or coverage ilike $${idx}
        or business_name ilike $${idx}
      )`);
      params.push(`%${term}%`);
      idx += 1;
    }

    params.push(limit);
    const rows = await q(
      `select id, created_at, updated_at, ws_id, mission_id,
              full_name, business_name, email, phone, coverage, availability,
              lanes, service_summary, proof_link, entity_type, licenses,
              status, admin_notes, tags, verified, dispatched, last_contacted_at,
              event_id
         from contractor_submissions
        where ${clauses.join(" and ")}
        order by created_at desc
        limit $${idx}`,
      params
    );

    const ids = rows.rows.map((row) => String(row.id || "")).filter(Boolean);
    const filesBySubmission = new Map<string, any[]>();

    if (ids.length) {
      const filePlaceholders = ids.map((_, index) => `$${index + 1}`).join(", ");
      const files = await q(
        `select id, submission_id, filename, content_type, bytes, created_at
           from submission_files
          where submission_id in (${filePlaceholders})
          order by created_at desc`,
        ids
      );
      for (const row of files.rows) {
        const submissionId = String(row.submission_id || "");
        if (!filesBySubmission.has(submissionId)) filesBySubmission.set(submissionId, []);
        filesBySubmission.get(submissionId)?.push({
          id: row.id,
          filename: row.filename,
          content_type: row.content_type,
          bytes: row.bytes,
          created_at: row.created_at,
        });
      }
    }

    return contractorJson(200, {
      ok: true,
      items: rows.rows.map((row) => ({
        ...row,
        lanes: normalizeContractorLanes(row.lanes),
        tags: normalizeContractorTags(row.tags),
        files: filesBySubmission.get(String(row.id || "")) || [],
      })),
    });
  } catch (error) {
    return contractorErrorResponse(error, "Submission list failed.");
  }
};
