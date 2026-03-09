import { getStore } from "@netlify/blobs";
import { contractorErrorResponse, contractorJson, requireContractorAdmin, resolveContractorAdminScope } from "./_shared/contractor-admin";
import { q } from "./_shared/neon";

export default async (request: Request, context: any) => {
  try {
    await requireContractorAdmin(request, context);
    const fileId = String(context?.params?.splat || "").trim();
    if (!fileId) {
      return contractorJson(400, { error: "Missing file id." });
    }

    const scope = await resolveContractorAdminScope();
    const rows = await q(
      `select sf.id, sf.submission_id, sf.blob_key, sf.filename, sf.content_type, sf.bytes
         from submission_files sf
         join contractor_submissions cs on cs.id = sf.submission_id
        where sf.id=$1
          and cs.org_id=$2
        limit 1`,
      [fileId, scope.orgId]
    );
    const file = rows.rows[0];
    if (!file) {
      return contractorJson(404, { error: "File not found." });
    }

    const store = getStore("skyes-contractor-files");
    const entry = await store.getWithMetadata(String(file.blob_key || ""), { type: "arrayBuffer" });
    if (!entry?.data) {
      return contractorJson(404, { error: "Blob not found." });
    }

    const buffer = Buffer.from(entry.data);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": String(file.content_type || "application/octet-stream"),
        "Content-Disposition": `attachment; filename="${String(file.filename || "file")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractorErrorResponse(error, "File download failed.");
  }
};
