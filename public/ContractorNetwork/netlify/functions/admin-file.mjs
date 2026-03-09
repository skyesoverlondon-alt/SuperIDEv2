import { getStore } from "@netlify/blobs";
import { getSql } from "./_lib/neon.mjs";
import { requireAdmin } from "./_lib/auth.mjs";
import { badRequest, serverError } from "./_lib/resp.mjs";

export default async (req, context) => {
  try {
    await requireAdmin(context, req);

    const fileId = (context?.params?.splat || "").trim();
    if (!fileId) return badRequest("Missing file id");

    const sql = getSql();
    const rows = await sql`
      SELECT id, submission_id, blob_key, filename, content_type, bytes
      FROM submission_files
      WHERE id = ${fileId}::uuid
      LIMIT 1
    `;

    const meta = rows?.[0];
    if (!meta) return new Response("Not found", { status: 404 });

    const store = getStore("skyes-contractor-files");
    const entry = await store.getWithMetadata(meta.blob_key, { type: "arrayBuffer" });
    if (!entry || !entry.data) return new Response("Blob not found", { status: 404 });

    const buf = Buffer.from(entry.data);

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": meta.content_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${meta.filename || "file"}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes("authorization")) return new Response(JSON.stringify({ error: msg }), { status: 401, headers: {"Content-Type":"application/json"}});
    return serverError("File download failed", { detail: msg });
  }
};
