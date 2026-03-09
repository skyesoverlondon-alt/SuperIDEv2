import { getStore } from "@netlify/blobs";
import { audit } from "./_shared/audit";
import {
  clampString,
  parseJsonList,
  readCorrelationIdFromHeaders,
  resolveContractorIntakeTarget,
  safeEmail,
  safeFilename,
  safePhone,
  safeUrl,
} from "./_shared/contractor-network";
import { q } from "./_shared/neon";
import { emitSovereignEvent } from "./_shared/sovereign-events";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed." });
    }

    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("multipart/form-data")) {
      return json(400, { error: "Expected multipart/form-data." });
    }

    const form = await request.formData();
    const target = await resolveContractorIntakeTarget();
    const correlationId = readCorrelationIdFromHeaders(request.headers);

    const fullName = clampString(form.get("full_name"), 120);
    const businessName = clampString(form.get("business_name"), 160);
    const email = safeEmail(form.get("email"));
    const phone = safePhone(form.get("phone"));
    const coverage = clampString(form.get("coverage"), 180);
    const availability = clampString(form.get("availability"), 40) || "unknown";
    const lanes = parseJsonList(form.get("lanes_json"), 6);
    const serviceSummary = clampString(form.get("service_summary"), 5000);
    const proofLink = safeUrl(form.get("proof_link"));
    const entityType = clampString(form.get("entity_type"), 60) || "independent_contractor";
    const licenses = clampString(form.get("licenses"), 800);

    if (!fullName) return json(400, { error: "Missing full_name." });
    if (!email) return json(400, { error: "Missing or invalid email." });
    if (!serviceSummary) return json(400, { error: "Missing service_summary." });

    const submissionId = crypto.randomUUID();
    await q(
      `insert into contractor_submissions(
         id, org_id, ws_id, mission_id, source_app,
         full_name, business_name, email, phone, coverage, availability,
         lanes, service_summary, proof_link, entity_type, licenses
       )
       values(
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9,$10,$11,
         $12::jsonb,$13,$14,$15,$16
       )`,
      [
        submissionId,
        target.orgId,
        target.wsId,
        target.missionId,
        "ContractorNetwork",
        fullName,
        businessName || null,
        email,
        phone || null,
        coverage || null,
        availability,
        JSON.stringify(lanes),
        serviceSummary,
        proofLink || null,
        entityType,
        licenses || null,
      ]
    );

    const files = form.getAll("files");
    const savedFiles: Array<{ id: string; filename: string; bytes: number }> = [];
    const store = getStore("skyes-contractor-files");
    const maxFiles = 6;
    const maxBytes = 6 * 1024 * 1024;

    for (let index = 0; index < Math.min(files.length, maxFiles); index += 1) {
      const file = files[index];
      if (!(file instanceof File)) continue;

      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > maxBytes) continue;

      const fileId = crypto.randomUUID();
      const filename = safeFilename(file.name || `file_${index + 1}`);
      const key = `submissions/${submissionId}/${fileId}/${filename}`;
      const contentTypeValue = clampString(file.type, 120) || "application/octet-stream";

      await store.set(key, file, {
        metadata: {
          submissionId,
          fileId,
          filename,
          contentType: contentTypeValue,
          bytes: String(buffer.byteLength),
        },
      });

      await q(
        `insert into submission_files(id, submission_id, blob_key, filename, content_type, bytes)
         values($1,$2,$3,$4,$5,$6)`,
        [fileId, submissionId, key, filename, contentTypeValue, buffer.byteLength]
      );

      savedFiles.push({ id: fileId, filename, bytes: buffer.byteLength });
    }

    const event = await emitSovereignEvent({
      actor: email,
      orgId: target.orgId,
      wsId: target.wsId,
      missionId: target.missionId,
      eventType: "contractor.submission.received",
      sourceApp: "ContractorNetwork",
      sourceRoute: "/api/intake",
      subjectKind: "contractor_submission",
      subjectId: submissionId,
      severity: "info",
      summary: `Contractor intake received: ${fullName}`,
      correlationId,
      idempotencyKey: submissionId,
      payload: {
        full_name: fullName,
        business_name: businessName || null,
        email,
        coverage: coverage || null,
        availability,
        lanes,
        entity_type: entityType,
        files: savedFiles,
      },
    });

    if (target.missionId) {
      await q(
        `insert into mission_assets(mission_id, source_app, asset_kind, asset_id, title, detail)
         values($1,$2,$3,$4,$5,$6::jsonb)
         on conflict (mission_id, asset_id)
         do update set
           source_app=excluded.source_app,
           asset_kind=excluded.asset_kind,
           title=excluded.title,
           detail=excluded.detail`,
        [
          target.missionId,
          "ContractorNetwork",
          "contractor_submission",
          submissionId,
          businessName || fullName,
          JSON.stringify({
            email,
            coverage: coverage || null,
            availability,
            lanes,
            files: savedFiles,
          }),
        ]
      );
    }

    if (event?.id) {
      await q("update contractor_submissions set event_id=$2 where id=$1", [submissionId, event.id]);
    }

    await audit(email, target.orgId, target.wsId, "contractor.intake", {
      submission_id: submissionId,
      mission_id: target.missionId,
      event_id: event?.id || null,
      files_count: savedFiles.length,
      lanes,
      correlation_id: correlationId || null,
    });

    return json(200, { ok: true, id: submissionId, event_id: event?.id || null, files: savedFiles });
  } catch (error: any) {
    const message = String(error?.message || "Intake failed.");
    const status = /not configured|does not belong/i.test(message) ? 503 : 500;
    return json(status, { error: message });
  }
};
