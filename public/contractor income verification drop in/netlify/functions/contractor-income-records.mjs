import { requireAdmin } from "./_lib/auth.mjs";
import { ok, badRequest, serverError } from "./_lib/resp.mjs";
import { safeUuid, safeDate, getSummaryBundle } from "./_lib/contractor-income.mjs";

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
    return ok({ ok: true, ...bundle });
  } catch (e) {
    return serverError("Failed to fetch contractor financial records", { detail: e.message || String(e) });
  }
};
