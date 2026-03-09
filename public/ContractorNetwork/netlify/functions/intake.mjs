import { getStore } from "@netlify/blobs";
import { getSql } from "./_lib/neon.mjs";
import { ok, badRequest, serverError } from "./_lib/resp.mjs";
import { clampString, safeEmail, safePhone, safeUrl, parseJSONList } from "./_lib/validate.mjs";

function safeFilename(name) {
  const raw = clampString(name, 180) || "file";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default async (req, context) => {
  try {
    if (req.method !== "POST") return badRequest("Method not allowed");
    const form = await req.formData();

    const full_name = clampString(form.get("full_name"), 120);
    const business_name = clampString(form.get("business_name"), 160);
    const email = safeEmail(form.get("email"));
    const phone = safePhone(form.get("phone"));
    const coverage = clampString(form.get("coverage"), 180);
    const availability = clampString(form.get("availability"), 40) || "unknown";
    const lanes = parseJSONList(form.get("lanes_json"), 6);
    const service_summary = clampString(form.get("service_summary"), 5000);
    const proof_link = safeUrl(form.get("proof_link"));
    const entity_type = clampString(form.get("entity_type"), 60) || "independent_contractor";
    const licenses = clampString(form.get("licenses"), 800);

    if (!full_name) return badRequest("Missing full_name");
    if (!email) return badRequest("Missing/invalid email");
    if (!service_summary) return badRequest("Missing service_summary");

    const id = crypto.randomUUID();
    const sql = getSql();

    await sql`
      INSERT INTO contractor_submissions (
        id, full_name, business_name, email, phone, coverage, availability,
        lanes, service_summary, proof_link, entity_type, licenses
      ) VALUES (
        ${id}, ${full_name}, ${business_name || null}, ${email}, ${phone || null},
        ${coverage || null}, ${availability},
        ${JSON.stringify(lanes)}, ${service_summary}, ${proof_link || null},
        ${entity_type}, ${licenses || null}
      )
    `;

    const store = getStore("skyes-contractor-files");
    const files = form.getAll("files") || [];
    const savedFiles = [];

    const MAX_FILES = 6;
    const MAX_BYTES = 6 * 1024 * 1024;

    for (let i = 0; i < Math.min(files.length, MAX_FILES); i++) {
      const file = files[i];
      if (!file || typeof file !== "object" || !("arrayBuffer" in file)) continue;

      const filename = safeFilename(file.name || `file_${i+1}`);
      const content_type = clampString(file.type, 120) || "application/octet-stream";

      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) continue;

      const fileId = crypto.randomUUID();
      const key = `submissions/${id}/${fileId}/${filename}`;

      await store.set(key, file, {
        metadata: {
          submissionId: id,
          fileId,
          filename,
          contentType: content_type,
          bytes: String(buf.byteLength)
        }
      });

      await sql`
        INSERT INTO submission_files (id, submission_id, blob_key, filename, content_type, bytes)
        VALUES (${fileId}, ${id}, ${key}, ${filename}, ${content_type}, ${buf.byteLength})
      `;

      savedFiles.push({ id: fileId, filename, bytes: buf.byteLength });
    }

    return ok({ ok: true, id, files: savedFiles });
  } catch (e) {
    return serverError("Intake failed", { detail: e.message || String(e) });
  }
};
