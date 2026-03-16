
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/intake.ts
import { getStore } from "@netlify/blobs";

// netlify/functions/_shared/env.ts
function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
function opt(name, fallback = "") {
  return process.env[name] || fallback;
}

// netlify/functions/_shared/neon.ts
function toHttpSqlEndpoint(url) {
  if (/^https?:\/\//i.test(url)) {
    return {
      endpoint: url,
      headers: { "Content-Type": "application/json" }
    };
  }
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const parsed = new URL(url);
    const endpoint = `https://${parsed.host}/sql`;
    return {
      endpoint,
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": url
      }
    };
  }
  throw new Error("NEON_DATABASE_URL must be an https SQL endpoint or postgres connection string.");
}
async function q(sql, params = []) {
  const url = must("NEON_DATABASE_URL");
  const target = toHttpSqlEndpoint(url);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify({ query: sql, params })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error: ${text}`);
  }
  return res.json();
}

// netlify/functions/_shared/audit.ts
async function audit(actor, org_id, ws_id, type, meta) {
  try {
    await q(
      "insert into audit_events(actor, org_id, ws_id, type, meta) values($1,$2,$3,$4,$5::jsonb)",
      [actor, org_id, ws_id, type, JSON.stringify(meta ?? {})]
    );
  } catch (_) {
  }
}

// netlify/functions/_shared/contractor-network.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function clampString(value, maxLength) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}
function clampArray(input, limit, maxLength) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => clampString(item, maxLength)).filter(Boolean).slice(0, limit);
}
function safeEmail(value) {
  const next = clampString(value, 254).toLowerCase();
  if (!next || !next.includes("@") || next.includes(" ")) return "";
  return next;
}
function safePhone(value) {
  return clampString(value, 40).replace(/[^\d+\-() ]/g, "").slice(0, 40);
}
function safeUrl(value) {
  const next = clampString(value, 500);
  if (!next) return "";
  try {
    const parsed = new URL(next);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}
function parseJsonList(value, limit) {
  if (Array.isArray(value)) return clampArray(value, limit, 80);
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return clampArray(parsed, limit, 80);
  } catch {
    return [];
  }
}
function safeFilename(value) {
  const next = clampString(value, 180) || "file";
  return next.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function isUuidLike(value) {
  return UUID_RE.test(String(value || "").trim());
}
function readCorrelationIdFromHeaders(headers) {
  const candidates = [
    headers.get("x-correlation-id"),
    headers.get("X-Correlation-Id"),
    headers.get("x_correlation_id")
  ];
  const value = clampString(candidates.find(Boolean), 128);
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
}
async function resolveContractorIntakeTarget() {
  const orgId = clampString(opt("CONTRACTOR_NETWORK_ORG_ID"), 64);
  const wsId = clampString(opt("CONTRACTOR_NETWORK_WS_ID"), 64) || null;
  const missionId = clampString(opt("CONTRACTOR_NETWORK_MISSION_ID"), 64) || null;
  if (!orgId) {
    throw new Error("Contractor Network intake is not configured. Missing CONTRACTOR_NETWORK_ORG_ID.");
  }
  if (!isUuidLike(orgId)) {
    throw new Error("CONTRACTOR_NETWORK_ORG_ID must be a UUID.");
  }
  if (wsId) {
    if (!isUuidLike(wsId)) {
      throw new Error("CONTRACTOR_NETWORK_WS_ID must be a UUID.");
    }
    const ws = await q("select id from workspaces where id=$1 and org_id=$2 limit 1", [wsId, orgId]);
    if (!ws.rows.length) {
      throw new Error("CONTRACTOR_NETWORK_WS_ID does not belong to CONTRACTOR_NETWORK_ORG_ID.");
    }
  }
  if (missionId) {
    if (!isUuidLike(missionId)) {
      throw new Error("CONTRACTOR_NETWORK_MISSION_ID must be a UUID.");
    }
    const mission = await q(
      "select id, ws_id from missions where id=$1 and org_id=$2 limit 1",
      [missionId, orgId]
    );
    if (!mission.rows.length) {
      throw new Error("CONTRACTOR_NETWORK_MISSION_ID does not belong to CONTRACTOR_NETWORK_ORG_ID.");
    }
    return {
      orgId,
      wsId: wsId || mission.rows[0]?.ws_id || null,
      missionId
    };
  }
  return { orgId, wsId, missionId: null };
}

// netlify/functions/_shared/sovereign-events.ts
import crypto2 from "crypto";
function inferEventFamily(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  const dot = normalized.indexOf(".");
  return dot === -1 ? normalized : normalized.slice(0, dot);
}
function buildInternalSignature(secret, parts) {
  const hmac = crypto2.createHmac("sha256", secret);
  hmac.update(JSON.stringify(parts));
  return hmac.digest("base64url");
}
async function emitSovereignEvent(input) {
  const eventType = String(input.eventType || "").trim().toLowerCase();
  if (!input.orgId || !eventType || !input.actor) return null;
  try {
    if (input.idempotencyKey) {
      const existing = await q(
        `select id, occurred_at
         from sovereign_events
         where org_id=$1
           and event_type=$2
           and ws_id is not distinct from $3
           and idempotency_key=$4
         order by occurred_at desc
         limit 1`,
        [input.orgId, eventType, input.wsId || null, input.idempotencyKey]
      );
      if (existing.rows.length) {
        return {
          id: existing.rows[0]?.id || null,
          occurred_at: existing.rows[0]?.occurred_at || null,
          duplicate: true
        };
      }
    }
    const payload = input.payload ?? {};
    const summary = String(input.summary || "").trim() || null;
    const occurredAt = (/* @__PURE__ */ new Date()).toISOString();
    const secret = String(process.env.RUNNER_SHARED_SECRET || "").trim();
    const internalSignature = secret ? buildInternalSignature(secret, {
      actor: input.actor,
      org_id: input.orgId,
      ws_id: input.wsId || null,
      event_type: eventType,
      occurred_at: occurredAt,
      payload
    }) : null;
    const inserted = await q(
      `insert into sovereign_events(
         occurred_at, org_id, ws_id, mission_id, event_type, event_family,
         source_app, source_route, actor, actor_user_id, subject_kind, subject_id,
         parent_event_id, severity, correlation_id, idempotency_key, internal_signature,
         summary, payload
       )
       values(
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,
         $18,$19::jsonb
       )
       returning id, occurred_at`,
      [
        occurredAt,
        input.orgId,
        input.wsId || null,
        input.missionId || null,
        eventType,
        inferEventFamily(eventType),
        input.sourceApp || null,
        input.sourceRoute || null,
        input.actor,
        input.actorUserId || null,
        input.subjectKind || null,
        input.subjectId || null,
        input.parentEventId || null,
        input.severity || "info",
        input.correlationId || null,
        input.idempotencyKey || null,
        internalSignature,
        summary,
        JSON.stringify(payload)
      ]
    );
    const eventId = inserted.rows[0]?.id || null;
    if (eventId) {
      try {
        await q(
          `insert into timeline_entries(
             at, org_id, ws_id, mission_id, event_id, entry_type, source_app,
             actor, actor_user_id, subject_kind, subject_id, title, summary, detail
           )
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            occurredAt,
            input.orgId,
            input.wsId || null,
            input.missionId || null,
            eventId,
            eventType,
            input.sourceApp || null,
            input.actor,
            input.actorUserId || null,
            input.subjectKind || null,
            input.subjectId || null,
            summary || eventType,
            summary,
            JSON.stringify(payload)
          ]
        );
      } catch {
      }
    }
    return {
      id: eventId,
      occurred_at: inserted.rows[0]?.occurred_at || occurredAt,
      duplicate: false
    };
  } catch {
    return null;
  }
}

// netlify/functions/intake.ts
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
var intake_default = async (request) => {
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
    const serviceSummary = clampString(form.get("service_summary"), 5e3);
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
        licenses || null
      ]
    );
    const files = form.getAll("files");
    const savedFiles = [];
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
          bytes: String(buffer.byteLength)
        }
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
        files: savedFiles
      }
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
            files: savedFiles
          })
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
      correlation_id: correlationId || null
    });
    return json(200, { ok: true, id: submissionId, event_id: event?.id || null, files: savedFiles });
  } catch (error) {
    const message = String(error?.message || "Intake failed.");
    const status = /not configured|does not belong/i.test(message) ? 503 : 500;
    return json(status, { error: message });
  }
};
export {
  intake_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvaW50YWtlLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvZW52LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvbmVvbi50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2F1ZGl0LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1uZXR3b3JrLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvc292ZXJlaWduLWV2ZW50cy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgZ2V0U3RvcmUgfSBmcm9tIFwiQG5ldGxpZnkvYmxvYnNcIjtcbmltcG9ydCB7IGF1ZGl0IH0gZnJvbSBcIi4vX3NoYXJlZC9hdWRpdFwiO1xuaW1wb3J0IHtcbiAgY2xhbXBTdHJpbmcsXG4gIHBhcnNlSnNvbkxpc3QsXG4gIHJlYWRDb3JyZWxhdGlvbklkRnJvbUhlYWRlcnMsXG4gIHJlc29sdmVDb250cmFjdG9ySW50YWtlVGFyZ2V0LFxuICBzYWZlRW1haWwsXG4gIHNhZmVGaWxlbmFtZSxcbiAgc2FmZVBob25lLFxuICBzYWZlVXJsLFxufSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItbmV0d29ya1wiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL19zaGFyZWQvbmVvblwiO1xuaW1wb3J0IHsgZW1pdFNvdmVyZWlnbkV2ZW50IH0gZnJvbSBcIi4vX3NoYXJlZC9zb3ZlcmVpZ24tZXZlbnRzXCI7XG5cbmZ1bmN0aW9uIGpzb24oc3RhdHVzOiBudW1iZXIsIGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoYm9keSksIHtcbiAgICBzdGF0dXMsXG4gICAgaGVhZGVyczoge1xuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1zdG9yZVwiLFxuICAgIH0sXG4gIH0pO1xufVxuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAocmVxdWVzdDogUmVxdWVzdCkgPT4ge1xuICB0cnkge1xuICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCAhPT0gXCJQT1NUXCIpIHtcbiAgICAgIHJldHVybiBqc29uKDQwNSwgeyBlcnJvcjogXCJNZXRob2Qgbm90IGFsbG93ZWQuXCIgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudFR5cGUgPSBTdHJpbmcocmVxdWVzdC5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKSB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghY29udGVudFR5cGUuaW5jbHVkZXMoXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCIpKSB7XG4gICAgICByZXR1cm4ganNvbig0MDAsIHsgZXJyb3I6IFwiRXhwZWN0ZWQgbXVsdGlwYXJ0L2Zvcm0tZGF0YS5cIiB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBmb3JtID0gYXdhaXQgcmVxdWVzdC5mb3JtRGF0YSgpO1xuICAgIGNvbnN0IHRhcmdldCA9IGF3YWl0IHJlc29sdmVDb250cmFjdG9ySW50YWtlVGFyZ2V0KCk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHJlYWRDb3JyZWxhdGlvbklkRnJvbUhlYWRlcnMocmVxdWVzdC5oZWFkZXJzKTtcblxuICAgIGNvbnN0IGZ1bGxOYW1lID0gY2xhbXBTdHJpbmcoZm9ybS5nZXQoXCJmdWxsX25hbWVcIiksIDEyMCk7XG4gICAgY29uc3QgYnVzaW5lc3NOYW1lID0gY2xhbXBTdHJpbmcoZm9ybS5nZXQoXCJidXNpbmVzc19uYW1lXCIpLCAxNjApO1xuICAgIGNvbnN0IGVtYWlsID0gc2FmZUVtYWlsKGZvcm0uZ2V0KFwiZW1haWxcIikpO1xuICAgIGNvbnN0IHBob25lID0gc2FmZVBob25lKGZvcm0uZ2V0KFwicGhvbmVcIikpO1xuICAgIGNvbnN0IGNvdmVyYWdlID0gY2xhbXBTdHJpbmcoZm9ybS5nZXQoXCJjb3ZlcmFnZVwiKSwgMTgwKTtcbiAgICBjb25zdCBhdmFpbGFiaWxpdHkgPSBjbGFtcFN0cmluZyhmb3JtLmdldChcImF2YWlsYWJpbGl0eVwiKSwgNDApIHx8IFwidW5rbm93blwiO1xuICAgIGNvbnN0IGxhbmVzID0gcGFyc2VKc29uTGlzdChmb3JtLmdldChcImxhbmVzX2pzb25cIiksIDYpO1xuICAgIGNvbnN0IHNlcnZpY2VTdW1tYXJ5ID0gY2xhbXBTdHJpbmcoZm9ybS5nZXQoXCJzZXJ2aWNlX3N1bW1hcnlcIiksIDUwMDApO1xuICAgIGNvbnN0IHByb29mTGluayA9IHNhZmVVcmwoZm9ybS5nZXQoXCJwcm9vZl9saW5rXCIpKTtcbiAgICBjb25zdCBlbnRpdHlUeXBlID0gY2xhbXBTdHJpbmcoZm9ybS5nZXQoXCJlbnRpdHlfdHlwZVwiKSwgNjApIHx8IFwiaW5kZXBlbmRlbnRfY29udHJhY3RvclwiO1xuICAgIGNvbnN0IGxpY2Vuc2VzID0gY2xhbXBTdHJpbmcoZm9ybS5nZXQoXCJsaWNlbnNlc1wiKSwgODAwKTtcblxuICAgIGlmICghZnVsbE5hbWUpIHJldHVybiBqc29uKDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIGZ1bGxfbmFtZS5cIiB9KTtcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4ganNvbig0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyBvciBpbnZhbGlkIGVtYWlsLlwiIH0pO1xuICAgIGlmICghc2VydmljZVN1bW1hcnkpIHJldHVybiBqc29uKDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHNlcnZpY2Vfc3VtbWFyeS5cIiB9KTtcblxuICAgIGNvbnN0IHN1Ym1pc3Npb25JZCA9IGNyeXB0by5yYW5kb21VVUlEKCk7XG4gICAgYXdhaXQgcShcbiAgICAgIGBpbnNlcnQgaW50byBjb250cmFjdG9yX3N1Ym1pc3Npb25zKFxuICAgICAgICAgaWQsIG9yZ19pZCwgd3NfaWQsIG1pc3Npb25faWQsIHNvdXJjZV9hcHAsXG4gICAgICAgICBmdWxsX25hbWUsIGJ1c2luZXNzX25hbWUsIGVtYWlsLCBwaG9uZSwgY292ZXJhZ2UsIGF2YWlsYWJpbGl0eSxcbiAgICAgICAgIGxhbmVzLCBzZXJ2aWNlX3N1bW1hcnksIHByb29mX2xpbmssIGVudGl0eV90eXBlLCBsaWNlbnNlc1xuICAgICAgIClcbiAgICAgICB2YWx1ZXMoXG4gICAgICAgICAkMSwkMiwkMywkNCwkNSxcbiAgICAgICAgICQ2LCQ3LCQ4LCQ5LCQxMCwkMTEsXG4gICAgICAgICAkMTI6Ompzb25iLCQxMywkMTQsJDE1LCQxNlxuICAgICAgIClgLFxuICAgICAgW1xuICAgICAgICBzdWJtaXNzaW9uSWQsXG4gICAgICAgIHRhcmdldC5vcmdJZCxcbiAgICAgICAgdGFyZ2V0LndzSWQsXG4gICAgICAgIHRhcmdldC5taXNzaW9uSWQsXG4gICAgICAgIFwiQ29udHJhY3Rvck5ldHdvcmtcIixcbiAgICAgICAgZnVsbE5hbWUsXG4gICAgICAgIGJ1c2luZXNzTmFtZSB8fCBudWxsLFxuICAgICAgICBlbWFpbCxcbiAgICAgICAgcGhvbmUgfHwgbnVsbCxcbiAgICAgICAgY292ZXJhZ2UgfHwgbnVsbCxcbiAgICAgICAgYXZhaWxhYmlsaXR5LFxuICAgICAgICBKU09OLnN0cmluZ2lmeShsYW5lcyksXG4gICAgICAgIHNlcnZpY2VTdW1tYXJ5LFxuICAgICAgICBwcm9vZkxpbmsgfHwgbnVsbCxcbiAgICAgICAgZW50aXR5VHlwZSxcbiAgICAgICAgbGljZW5zZXMgfHwgbnVsbCxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgY29uc3QgZmlsZXMgPSBmb3JtLmdldEFsbChcImZpbGVzXCIpO1xuICAgIGNvbnN0IHNhdmVkRmlsZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgZmlsZW5hbWU6IHN0cmluZzsgYnl0ZXM6IG51bWJlciB9PiA9IFtdO1xuICAgIGNvbnN0IHN0b3JlID0gZ2V0U3RvcmUoXCJza3llcy1jb250cmFjdG9yLWZpbGVzXCIpO1xuICAgIGNvbnN0IG1heEZpbGVzID0gNjtcbiAgICBjb25zdCBtYXhCeXRlcyA9IDYgKiAxMDI0ICogMTAyNDtcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBNYXRoLm1pbihmaWxlcy5sZW5ndGgsIG1heEZpbGVzKTsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgZmlsZSA9IGZpbGVzW2luZGV4XTtcbiAgICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBGaWxlKSkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5mcm9tKGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKSk7XG4gICAgICBpZiAoYnVmZmVyLmJ5dGVMZW5ndGggPiBtYXhCeXRlcykgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGZpbGVJZCA9IGNyeXB0by5yYW5kb21VVUlEKCk7XG4gICAgICBjb25zdCBmaWxlbmFtZSA9IHNhZmVGaWxlbmFtZShmaWxlLm5hbWUgfHwgYGZpbGVfJHtpbmRleCArIDF9YCk7XG4gICAgICBjb25zdCBrZXkgPSBgc3VibWlzc2lvbnMvJHtzdWJtaXNzaW9uSWR9LyR7ZmlsZUlkfS8ke2ZpbGVuYW1lfWA7XG4gICAgICBjb25zdCBjb250ZW50VHlwZVZhbHVlID0gY2xhbXBTdHJpbmcoZmlsZS50eXBlLCAxMjApIHx8IFwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtXCI7XG5cbiAgICAgIGF3YWl0IHN0b3JlLnNldChrZXksIGZpbGUsIHtcbiAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICBzdWJtaXNzaW9uSWQsXG4gICAgICAgICAgZmlsZUlkLFxuICAgICAgICAgIGZpbGVuYW1lLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBjb250ZW50VHlwZVZhbHVlLFxuICAgICAgICAgIGJ5dGVzOiBTdHJpbmcoYnVmZmVyLmJ5dGVMZW5ndGgpLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IHEoXG4gICAgICAgIGBpbnNlcnQgaW50byBzdWJtaXNzaW9uX2ZpbGVzKGlkLCBzdWJtaXNzaW9uX2lkLCBibG9iX2tleSwgZmlsZW5hbWUsIGNvbnRlbnRfdHlwZSwgYnl0ZXMpXG4gICAgICAgICB2YWx1ZXMoJDEsJDIsJDMsJDQsJDUsJDYpYCxcbiAgICAgICAgW2ZpbGVJZCwgc3VibWlzc2lvbklkLCBrZXksIGZpbGVuYW1lLCBjb250ZW50VHlwZVZhbHVlLCBidWZmZXIuYnl0ZUxlbmd0aF1cbiAgICAgICk7XG5cbiAgICAgIHNhdmVkRmlsZXMucHVzaCh7IGlkOiBmaWxlSWQsIGZpbGVuYW1lLCBieXRlczogYnVmZmVyLmJ5dGVMZW5ndGggfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXZlbnQgPSBhd2FpdCBlbWl0U292ZXJlaWduRXZlbnQoe1xuICAgICAgYWN0b3I6IGVtYWlsLFxuICAgICAgb3JnSWQ6IHRhcmdldC5vcmdJZCxcbiAgICAgIHdzSWQ6IHRhcmdldC53c0lkLFxuICAgICAgbWlzc2lvbklkOiB0YXJnZXQubWlzc2lvbklkLFxuICAgICAgZXZlbnRUeXBlOiBcImNvbnRyYWN0b3Iuc3VibWlzc2lvbi5yZWNlaXZlZFwiLFxuICAgICAgc291cmNlQXBwOiBcIkNvbnRyYWN0b3JOZXR3b3JrXCIsXG4gICAgICBzb3VyY2VSb3V0ZTogXCIvYXBpL2ludGFrZVwiLFxuICAgICAgc3ViamVjdEtpbmQ6IFwiY29udHJhY3Rvcl9zdWJtaXNzaW9uXCIsXG4gICAgICBzdWJqZWN0SWQ6IHN1Ym1pc3Npb25JZCxcbiAgICAgIHNldmVyaXR5OiBcImluZm9cIixcbiAgICAgIHN1bW1hcnk6IGBDb250cmFjdG9yIGludGFrZSByZWNlaXZlZDogJHtmdWxsTmFtZX1gLFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGlkZW1wb3RlbmN5S2V5OiBzdWJtaXNzaW9uSWQsXG4gICAgICBwYXlsb2FkOiB7XG4gICAgICAgIGZ1bGxfbmFtZTogZnVsbE5hbWUsXG4gICAgICAgIGJ1c2luZXNzX25hbWU6IGJ1c2luZXNzTmFtZSB8fCBudWxsLFxuICAgICAgICBlbWFpbCxcbiAgICAgICAgY292ZXJhZ2U6IGNvdmVyYWdlIHx8IG51bGwsXG4gICAgICAgIGF2YWlsYWJpbGl0eSxcbiAgICAgICAgbGFuZXMsXG4gICAgICAgIGVudGl0eV90eXBlOiBlbnRpdHlUeXBlLFxuICAgICAgICBmaWxlczogc2F2ZWRGaWxlcyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAodGFyZ2V0Lm1pc3Npb25JZCkge1xuICAgICAgYXdhaXQgcShcbiAgICAgICAgYGluc2VydCBpbnRvIG1pc3Npb25fYXNzZXRzKG1pc3Npb25faWQsIHNvdXJjZV9hcHAsIGFzc2V0X2tpbmQsIGFzc2V0X2lkLCB0aXRsZSwgZGV0YWlsKVxuICAgICAgICAgdmFsdWVzKCQxLCQyLCQzLCQ0LCQ1LCQ2Ojpqc29uYilcbiAgICAgICAgIG9uIGNvbmZsaWN0IChtaXNzaW9uX2lkLCBhc3NldF9pZClcbiAgICAgICAgIGRvIHVwZGF0ZSBzZXRcbiAgICAgICAgICAgc291cmNlX2FwcD1leGNsdWRlZC5zb3VyY2VfYXBwLFxuICAgICAgICAgICBhc3NldF9raW5kPWV4Y2x1ZGVkLmFzc2V0X2tpbmQsXG4gICAgICAgICAgIHRpdGxlPWV4Y2x1ZGVkLnRpdGxlLFxuICAgICAgICAgICBkZXRhaWw9ZXhjbHVkZWQuZGV0YWlsYCxcbiAgICAgICAgW1xuICAgICAgICAgIHRhcmdldC5taXNzaW9uSWQsXG4gICAgICAgICAgXCJDb250cmFjdG9yTmV0d29ya1wiLFxuICAgICAgICAgIFwiY29udHJhY3Rvcl9zdWJtaXNzaW9uXCIsXG4gICAgICAgICAgc3VibWlzc2lvbklkLFxuICAgICAgICAgIGJ1c2luZXNzTmFtZSB8fCBmdWxsTmFtZSxcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBlbWFpbCxcbiAgICAgICAgICAgIGNvdmVyYWdlOiBjb3ZlcmFnZSB8fCBudWxsLFxuICAgICAgICAgICAgYXZhaWxhYmlsaXR5LFxuICAgICAgICAgICAgbGFuZXMsXG4gICAgICAgICAgICBmaWxlczogc2F2ZWRGaWxlcyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQ/LmlkKSB7XG4gICAgICBhd2FpdCBxKFwidXBkYXRlIGNvbnRyYWN0b3Jfc3VibWlzc2lvbnMgc2V0IGV2ZW50X2lkPSQyIHdoZXJlIGlkPSQxXCIsIFtzdWJtaXNzaW9uSWQsIGV2ZW50LmlkXSk7XG4gICAgfVxuXG4gICAgYXdhaXQgYXVkaXQoZW1haWwsIHRhcmdldC5vcmdJZCwgdGFyZ2V0LndzSWQsIFwiY29udHJhY3Rvci5pbnRha2VcIiwge1xuICAgICAgc3VibWlzc2lvbl9pZDogc3VibWlzc2lvbklkLFxuICAgICAgbWlzc2lvbl9pZDogdGFyZ2V0Lm1pc3Npb25JZCxcbiAgICAgIGV2ZW50X2lkOiBldmVudD8uaWQgfHwgbnVsbCxcbiAgICAgIGZpbGVzX2NvdW50OiBzYXZlZEZpbGVzLmxlbmd0aCxcbiAgICAgIGxhbmVzLFxuICAgICAgY29ycmVsYXRpb25faWQ6IGNvcnJlbGF0aW9uSWQgfHwgbnVsbCxcbiAgICB9KTtcblxuICAgIHJldHVybiBqc29uKDIwMCwgeyBvazogdHJ1ZSwgaWQ6IHN1Ym1pc3Npb25JZCwgZXZlbnRfaWQ6IGV2ZW50Py5pZCB8fCBudWxsLCBmaWxlczogc2F2ZWRGaWxlcyB9KTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBTdHJpbmcoZXJyb3I/Lm1lc3NhZ2UgfHwgXCJJbnRha2UgZmFpbGVkLlwiKTtcbiAgICBjb25zdCBzdGF0dXMgPSAvbm90IGNvbmZpZ3VyZWR8ZG9lcyBub3QgYmVsb25nL2kudGVzdChtZXNzYWdlKSA/IDUwMyA6IDUwMDtcbiAgICByZXR1cm4ganNvbihzdGF0dXMsIHsgZXJyb3I6IG1lc3NhZ2UgfSk7XG4gIH1cbn07XG4iLCAiLyoqXG4gKiBFbnZpcm9ubWVudCB2YXJpYWJsZSBoZWxwZXJzIGZvciBOZXRsaWZ5IGZ1bmN0aW9ucy4gIFVzZSBtdXN0KClcbiAqIHdoZW4gYW4gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQ7IGl0IHRocm93cyBhbiBlcnJvclxuICogaW5zdGVhZCBvZiByZXR1cm5pbmcgdW5kZWZpbmVkLiAgVXNlIG9wdCgpIGZvciBvcHRpb25hbCB2YWx1ZXNcbiAqIHdpdGggYW4gb3B0aW9uYWwgZmFsbGJhY2suXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtdXN0KG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHYgPSBwcm9jZXNzLmVudltuYW1lXTtcbiAgaWYgKCF2KSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgZW52IHZhcjogJHtuYW1lfWApO1xuICByZXR1cm4gdjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wdChuYW1lOiBzdHJpbmcsIGZhbGxiYWNrID0gXCJcIik6IHN0cmluZyB7XG4gIHJldHVybiBwcm9jZXNzLmVudltuYW1lXSB8fCBmYWxsYmFjaztcbn0iLCAiaW1wb3J0IHsgbXVzdCB9IGZyb20gXCIuL2VudlwiO1xuXG5mdW5jdGlvbiB0b0h0dHBTcWxFbmRwb2ludCh1cmw6IHN0cmluZyk6IHsgZW5kcG9pbnQ6IHN0cmluZzsgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB9IHtcbiAgaWYgKC9eaHR0cHM/OlxcL1xcLy9pLnRlc3QodXJsKSkge1xuICAgIHJldHVybiB7XG4gICAgICBlbmRwb2ludDogdXJsLFxuICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgIH07XG4gIH1cblxuICBpZiAoL15wb3N0Z3JlcyhxbCk/OlxcL1xcLy9pLnRlc3QodXJsKSkge1xuICAgIGNvbnN0IHBhcnNlZCA9IG5ldyBVUkwodXJsKTtcbiAgICBjb25zdCBlbmRwb2ludCA9IGBodHRwczovLyR7cGFyc2VkLmhvc3R9L3NxbGA7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgXCJOZW9uLUNvbm5lY3Rpb24tU3RyaW5nXCI6IHVybCxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIk5FT05fREFUQUJBU0VfVVJMIG11c3QgYmUgYW4gaHR0cHMgU1FMIGVuZHBvaW50IG9yIHBvc3RncmVzIGNvbm5lY3Rpb24gc3RyaW5nLlwiKTtcbn1cblxuLyoqXG4gKiBFeGVjdXRlIGEgU1FMIHF1ZXJ5IGFnYWluc3QgdGhlIE5lb24gc2VydmVybGVzcyBkYXRhYmFzZSB2aWEgdGhlXG4gKiBIVFRQIGVuZHBvaW50LiAgVGhlIE5FT05fREFUQUJBU0VfVVJMIGVudmlyb25tZW50IHZhcmlhYmxlIG11c3RcbiAqIGJlIHNldCB0byBhIHZhbGlkIE5lb24gU1FMLW92ZXItSFRUUCBlbmRwb2ludC4gIFJldHVybnMgdGhlXG4gKiBwYXJzZWQgSlNPTiByZXN1bHQgd2hpY2ggaW5jbHVkZXMgYSAncm93cycgYXJyYXkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBxKHNxbDogc3RyaW5nLCBwYXJhbXM6IGFueVtdID0gW10pIHtcbiAgY29uc3QgdXJsID0gbXVzdChcIk5FT05fREFUQUJBU0VfVVJMXCIpO1xuICBjb25zdCB0YXJnZXQgPSB0b0h0dHBTcWxFbmRwb2ludCh1cmwpO1xuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0YXJnZXQuZW5kcG9pbnQsIHtcbiAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgIGhlYWRlcnM6IHRhcmdldC5oZWFkZXJzLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IHNxbCwgcGFyYW1zIH0pLFxuICB9KTtcbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYERCIGVycm9yOiAke3RleHR9YCk7XG4gIH1cbiAgcmV0dXJuIHJlcy5qc29uKCkgYXMgUHJvbWlzZTx7IHJvd3M6IGFueVtdIH0+O1xufSIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG4vKipcbiAqIFJlY29yZCBhbiBhdWRpdCBldmVudCBpbiB0aGUgZGF0YWJhc2UuICBBbGwgY29uc2VxdWVudGlhbFxuICogb3BlcmF0aW9ucyBzaG91bGQgZW1pdCBhbiBhdWRpdCBldmVudCB3aXRoIGFjdG9yLCBvcmcsIHdvcmtzcGFjZSxcbiAqIHR5cGUgYW5kIGFyYml0cmFyeSBtZXRhZGF0YS4gIEVycm9ycyBhcmUgc3dhbGxvd2VkIHNpbGVudGx5XG4gKiBiZWNhdXNlIGF1ZGl0IGxvZ2dpbmcgbXVzdCBuZXZlciBicmVhayB1c2VyIGZsb3dzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXVkaXQoXG4gIGFjdG9yOiBzdHJpbmcsXG4gIG9yZ19pZDogc3RyaW5nIHwgbnVsbCxcbiAgd3NfaWQ6IHN0cmluZyB8IG51bGwsXG4gIHR5cGU6IHN0cmluZyxcbiAgbWV0YTogYW55XG4pIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBxKFxuICAgICAgXCJpbnNlcnQgaW50byBhdWRpdF9ldmVudHMoYWN0b3IsIG9yZ19pZCwgd3NfaWQsIHR5cGUsIG1ldGEpIHZhbHVlcygkMSwkMiwkMywkNCwkNTo6anNvbmIpXCIsXG4gICAgICBbYWN0b3IsIG9yZ19pZCwgd3NfaWQsIHR5cGUsIEpTT04uc3RyaW5naWZ5KG1ldGEgPz8ge30pXVxuICAgICk7XG4gIH0gY2F0Y2ggKF8pIHtcbiAgICAvLyBpZ25vcmUgYXVkaXQgZmFpbHVyZXNcbiAgfVxufSIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuaW1wb3J0IHsgb3B0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmV4cG9ydCB0eXBlIENvbnRyYWN0b3JJbnRha2VUYXJnZXQgPSB7XG4gIG9yZ0lkOiBzdHJpbmc7XG4gIHdzSWQ6IHN0cmluZyB8IG51bGw7XG4gIG1pc3Npb25JZDogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmNvbnN0IFVVSURfUkUgPSAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLTVdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBBcnJheShpbnB1dDogdW5rbm93biwgbGltaXQ6IG51bWJlciwgbWF4TGVuZ3RoOiBudW1iZXIpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGlucHV0KSkgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xuICByZXR1cm4gaW5wdXRcbiAgICAubWFwKChpdGVtKSA9PiBjbGFtcFN0cmluZyhpdGVtLCBtYXhMZW5ndGgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAuc2xpY2UoMCwgbGltaXQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZUVtYWlsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIW5leHQgfHwgIW5leHQuaW5jbHVkZXMoXCJAXCIpIHx8IG5leHQuaW5jbHVkZXMoXCIgXCIpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlUGhvbmUodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkucmVwbGFjZSgvW15cXGQrXFwtKCkgXS9nLCBcIlwiKS5zbGljZSgwLCA0MCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNTAwKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG5leHQpO1xuICAgIGlmIChwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cDpcIiAmJiBwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cHM6XCIpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSnNvbkxpc3QodmFsdWU6IHVua25vd24sIGxpbWl0OiBudW1iZXIpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gY2xhbXBBcnJheSh2YWx1ZSwgbGltaXQsIDgwKTtcbiAgY29uc3QgcmF3ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXSBhcyBzdHJpbmdbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgcmV0dXJuIGNsYW1wQXJyYXkocGFyc2VkLCBsaW1pdCwgODApO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW10gYXMgc3RyaW5nW107XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVGaWxlbmFtZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDE4MCkgfHwgXCJmaWxlXCI7XG4gIHJldHVybiBuZXh0LnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1V1aWRMaWtlKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBVVUlEX1JFLnRlc3QoU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29ycmVsYXRpb25JZEZyb21IZWFkZXJzKGhlYWRlcnM6IEhlYWRlcnMpIHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBoZWFkZXJzLmdldChcIngtY29ycmVsYXRpb24taWRcIiksXG4gICAgaGVhZGVycy5nZXQoXCJYLUNvcnJlbGF0aW9uLUlkXCIpLFxuICAgIGhlYWRlcnMuZ2V0KFwieF9jb3JyZWxhdGlvbl9pZFwiKSxcbiAgXTtcbiAgY29uc3QgdmFsdWUgPSBjbGFtcFN0cmluZyhjYW5kaWRhdGVzLmZpbmQoQm9vbGVhbiksIDEyOCk7XG4gIGlmICghdmFsdWUpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvW15hLXpBLVowLTk6X1xcLS5dL2csIFwiXCIpLnNsaWNlKDAsIDEyOCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpIHtcbiAgY29uc3Qgb3JnSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfT1JHX0lEXCIpLCA2NCk7XG4gIGNvbnN0IHdzSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfV1NfSURcIiksIDY0KSB8fCBudWxsO1xuICBjb25zdCBtaXNzaW9uSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRFwiKSwgNjQpIHx8IG51bGw7XG5cbiAgaWYgKCFvcmdJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3IgTmV0d29yayBpbnRha2UgaXMgbm90IGNvbmZpZ3VyZWQuIE1pc3NpbmcgQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gIH1cblxuICBpZiAoIWlzVXVpZExpa2Uob3JnSWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gIH1cblxuICBpZiAod3NJZCkge1xuICAgIGlmICghaXNVdWlkTGlrZSh3c0lkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3Qgd3MgPSBhd2FpdCBxKFwic2VsZWN0IGlkIGZyb20gd29ya3NwYWNlcyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIiwgW3dzSWQsIG9yZ0lkXSk7XG4gICAgaWYgKCF3cy5yb3dzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIGRvZXMgbm90IGJlbG9uZyB0byBDT05UUkFDVE9SX05FVFdPUktfT1JHX0lELlwiKTtcbiAgICB9XG4gIH1cblxuICBpZiAobWlzc2lvbklkKSB7XG4gICAgaWYgKCFpc1V1aWRMaWtlKG1pc3Npb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19NSVNTSU9OX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3QgbWlzc2lvbiA9IGF3YWl0IHEoXG4gICAgICBcInNlbGVjdCBpZCwgd3NfaWQgZnJvbSBtaXNzaW9ucyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIixcbiAgICAgIFttaXNzaW9uSWQsIG9yZ0lkXVxuICAgICk7XG4gICAgaWYgKCFtaXNzaW9uLnJvd3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRCBkb2VzIG5vdCBiZWxvbmcgdG8gQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBvcmdJZCxcbiAgICAgIHdzSWQ6IHdzSWQgfHwgbWlzc2lvbi5yb3dzWzBdPy53c19pZCB8fCBudWxsLFxuICAgICAgbWlzc2lvbklkLFxuICAgIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG4gIH1cblxuICByZXR1cm4geyBvcmdJZCwgd3NJZCwgbWlzc2lvbklkOiBudWxsIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG59XG4iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgdHlwZSBTb3ZlcmVpZ25FdmVudFNldmVyaXR5ID0gXCJpbmZvXCIgfCBcIndhcm5pbmdcIiB8IFwiZXJyb3JcIiB8IFwiY3JpdGljYWxcIjtcblxudHlwZSBFbWl0U292ZXJlaWduRXZlbnRJbnB1dCA9IHtcbiAgYWN0b3I6IHN0cmluZztcbiAgYWN0b3JVc2VySWQ/OiBzdHJpbmcgfCBudWxsO1xuICBvcmdJZDogc3RyaW5nO1xuICB3c0lkPzogc3RyaW5nIHwgbnVsbDtcbiAgbWlzc2lvbklkPzogc3RyaW5nIHwgbnVsbDtcbiAgZXZlbnRUeXBlOiBzdHJpbmc7XG4gIHNvdXJjZUFwcD86IHN0cmluZyB8IG51bGw7XG4gIHNvdXJjZVJvdXRlPzogc3RyaW5nIHwgbnVsbDtcbiAgc3ViamVjdEtpbmQ/OiBzdHJpbmcgfCBudWxsO1xuICBzdWJqZWN0SWQ/OiBzdHJpbmcgfCBudWxsO1xuICBwYXJlbnRFdmVudElkPzogc3RyaW5nIHwgbnVsbDtcbiAgc2V2ZXJpdHk/OiBTb3ZlcmVpZ25FdmVudFNldmVyaXR5O1xuICBzdW1tYXJ5Pzogc3RyaW5nIHwgbnVsbDtcbiAgY29ycmVsYXRpb25JZD86IHN0cmluZyB8IG51bGw7XG4gIGlkZW1wb3RlbmN5S2V5Pzogc3RyaW5nIHwgbnVsbDtcbiAgcGF5bG9hZD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxuZnVuY3Rpb24gaW5mZXJFdmVudEZhbWlseShldmVudFR5cGU6IHN0cmluZykge1xuICBjb25zdCBub3JtYWxpemVkID0gU3RyaW5nKGV2ZW50VHlwZSB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgZG90ID0gbm9ybWFsaXplZC5pbmRleE9mKFwiLlwiKTtcbiAgcmV0dXJuIGRvdCA9PT0gLTEgPyBub3JtYWxpemVkIDogbm9ybWFsaXplZC5zbGljZSgwLCBkb3QpO1xufVxuXG5mdW5jdGlvbiBidWlsZEludGVybmFsU2lnbmF0dXJlKHNlY3JldDogc3RyaW5nLCBwYXJ0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgY29uc3QgaG1hYyA9IGNyeXB0by5jcmVhdGVIbWFjKFwic2hhMjU2XCIsIHNlY3JldCk7XG4gIGhtYWMudXBkYXRlKEpTT04uc3RyaW5naWZ5KHBhcnRzKSk7XG4gIHJldHVybiBobWFjLmRpZ2VzdChcImJhc2U2NHVybFwiKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVtaXRTb3ZlcmVpZ25FdmVudChpbnB1dDogRW1pdFNvdmVyZWlnbkV2ZW50SW5wdXQpIHtcbiAgY29uc3QgZXZlbnRUeXBlID0gU3RyaW5nKGlucHV0LmV2ZW50VHlwZSB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKCFpbnB1dC5vcmdJZCB8fCAhZXZlbnRUeXBlIHx8ICFpbnB1dC5hY3RvcikgcmV0dXJuIG51bGw7XG5cbiAgdHJ5IHtcbiAgICBpZiAoaW5wdXQuaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcShcbiAgICAgICAgYHNlbGVjdCBpZCwgb2NjdXJyZWRfYXRcbiAgICAgICAgIGZyb20gc292ZXJlaWduX2V2ZW50c1xuICAgICAgICAgd2hlcmUgb3JnX2lkPSQxXG4gICAgICAgICAgIGFuZCBldmVudF90eXBlPSQyXG4gICAgICAgICAgIGFuZCB3c19pZCBpcyBub3QgZGlzdGluY3QgZnJvbSAkM1xuICAgICAgICAgICBhbmQgaWRlbXBvdGVuY3lfa2V5PSQ0XG4gICAgICAgICBvcmRlciBieSBvY2N1cnJlZF9hdCBkZXNjXG4gICAgICAgICBsaW1pdCAxYCxcbiAgICAgICAgW2lucHV0Lm9yZ0lkLCBldmVudFR5cGUsIGlucHV0LndzSWQgfHwgbnVsbCwgaW5wdXQuaWRlbXBvdGVuY3lLZXldXG4gICAgICApO1xuICAgICAgaWYgKGV4aXN0aW5nLnJvd3MubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IGV4aXN0aW5nLnJvd3NbMF0/LmlkIHx8IG51bGwsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IGV4aXN0aW5nLnJvd3NbMF0/Lm9jY3VycmVkX2F0IHx8IG51bGwsXG4gICAgICAgICAgZHVwbGljYXRlOiB0cnVlLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBpbnB1dC5wYXlsb2FkID8/IHt9O1xuICAgIGNvbnN0IHN1bW1hcnkgPSBTdHJpbmcoaW5wdXQuc3VtbWFyeSB8fCBcIlwiKS50cmltKCkgfHwgbnVsbDtcbiAgICBjb25zdCBvY2N1cnJlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHNlY3JldCA9IFN0cmluZyhwcm9jZXNzLmVudi5SVU5ORVJfU0hBUkVEX1NFQ1JFVCB8fCBcIlwiKS50cmltKCk7XG4gICAgY29uc3QgaW50ZXJuYWxTaWduYXR1cmUgPSBzZWNyZXRcbiAgICAgID8gYnVpbGRJbnRlcm5hbFNpZ25hdHVyZShzZWNyZXQsIHtcbiAgICAgICAgICBhY3RvcjogaW5wdXQuYWN0b3IsXG4gICAgICAgICAgb3JnX2lkOiBpbnB1dC5vcmdJZCxcbiAgICAgICAgICB3c19pZDogaW5wdXQud3NJZCB8fCBudWxsLFxuICAgICAgICAgIGV2ZW50X3R5cGU6IGV2ZW50VHlwZSxcbiAgICAgICAgICBvY2N1cnJlZF9hdDogb2NjdXJyZWRBdCxcbiAgICAgICAgICBwYXlsb2FkLFxuICAgICAgICB9KVxuICAgICAgOiBudWxsO1xuXG4gICAgY29uc3QgaW5zZXJ0ZWQgPSBhd2FpdCBxKFxuICAgICAgYGluc2VydCBpbnRvIHNvdmVyZWlnbl9ldmVudHMoXG4gICAgICAgICBvY2N1cnJlZF9hdCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZXZlbnRfdHlwZSwgZXZlbnRfZmFtaWx5LFxuICAgICAgICAgc291cmNlX2FwcCwgc291cmNlX3JvdXRlLCBhY3RvciwgYWN0b3JfdXNlcl9pZCwgc3ViamVjdF9raW5kLCBzdWJqZWN0X2lkLFxuICAgICAgICAgcGFyZW50X2V2ZW50X2lkLCBzZXZlcml0eSwgY29ycmVsYXRpb25faWQsIGlkZW1wb3RlbmN5X2tleSwgaW50ZXJuYWxfc2lnbmF0dXJlLFxuICAgICAgICAgc3VtbWFyeSwgcGF5bG9hZFxuICAgICAgIClcbiAgICAgICB2YWx1ZXMoXG4gICAgICAgICAkMSwkMiwkMywkNCwkNSwkNixcbiAgICAgICAgICQ3LCQ4LCQ5LCQxMCwkMTEsJDEyLFxuICAgICAgICAgJDEzLCQxNCwkMTUsJDE2LCQxNyxcbiAgICAgICAgICQxOCwkMTk6Ompzb25iXG4gICAgICAgKVxuICAgICAgIHJldHVybmluZyBpZCwgb2NjdXJyZWRfYXRgLFxuICAgICAgW1xuICAgICAgICBvY2N1cnJlZEF0LFxuICAgICAgICBpbnB1dC5vcmdJZCxcbiAgICAgICAgaW5wdXQud3NJZCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5taXNzaW9uSWQgfHwgbnVsbCxcbiAgICAgICAgZXZlbnRUeXBlLFxuICAgICAgICBpbmZlckV2ZW50RmFtaWx5KGV2ZW50VHlwZSksXG4gICAgICAgIGlucHV0LnNvdXJjZUFwcCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5zb3VyY2VSb3V0ZSB8fCBudWxsLFxuICAgICAgICBpbnB1dC5hY3RvcixcbiAgICAgICAgaW5wdXQuYWN0b3JVc2VySWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc3ViamVjdEtpbmQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc3ViamVjdElkIHx8IG51bGwsXG4gICAgICAgIGlucHV0LnBhcmVudEV2ZW50SWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc2V2ZXJpdHkgfHwgXCJpbmZvXCIsXG4gICAgICAgIGlucHV0LmNvcnJlbGF0aW9uSWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuaWRlbXBvdGVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgaW50ZXJuYWxTaWduYXR1cmUsXG4gICAgICAgIHN1bW1hcnksXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgXVxuICAgICk7XG5cbiAgICBjb25zdCBldmVudElkID0gaW5zZXJ0ZWQucm93c1swXT8uaWQgfHwgbnVsbDtcbiAgICBpZiAoZXZlbnRJZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcShcbiAgICAgICAgICBgaW5zZXJ0IGludG8gdGltZWxpbmVfZW50cmllcyhcbiAgICAgICAgICAgICBhdCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZXZlbnRfaWQsIGVudHJ5X3R5cGUsIHNvdXJjZV9hcHAsXG4gICAgICAgICAgICAgYWN0b3IsIGFjdG9yX3VzZXJfaWQsIHN1YmplY3Rfa2luZCwgc3ViamVjdF9pZCwgdGl0bGUsIHN1bW1hcnksIGRldGFpbFxuICAgICAgICAgICApXG4gICAgICAgICAgIHZhbHVlcygkMSwkMiwkMywkNCwkNSwkNiwkNywkOCwkOSwkMTAsJDExLCQxMiwkMTMsJDE0Ojpqc29uYilgLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIG9jY3VycmVkQXQsXG4gICAgICAgICAgICBpbnB1dC5vcmdJZCxcbiAgICAgICAgICAgIGlucHV0LndzSWQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0Lm1pc3Npb25JZCB8fCBudWxsLFxuICAgICAgICAgICAgZXZlbnRJZCxcbiAgICAgICAgICAgIGV2ZW50VHlwZSxcbiAgICAgICAgICAgIGlucHV0LnNvdXJjZUFwcCB8fCBudWxsLFxuICAgICAgICAgICAgaW5wdXQuYWN0b3IsXG4gICAgICAgICAgICBpbnB1dC5hY3RvclVzZXJJZCB8fCBudWxsLFxuICAgICAgICAgICAgaW5wdXQuc3ViamVjdEtpbmQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0LnN1YmplY3RJZCB8fCBudWxsLFxuICAgICAgICAgICAgc3VtbWFyeSB8fCBldmVudFR5cGUsXG4gICAgICAgICAgICBzdW1tYXJ5LFxuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgXVxuICAgICAgICApO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRpbWVsaW5lIGZhbm91dCBtdXN0IG5vdCBicmVhayB0aGUgb3JpZ2luYXRpbmcgYWN0aW9uLlxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpZDogZXZlbnRJZCxcbiAgICAgIG9jY3VycmVkX2F0OiBpbnNlcnRlZC5yb3dzWzBdPy5vY2N1cnJlZF9hdCB8fCBvY2N1cnJlZEF0LFxuICAgICAgZHVwbGljYXRlOiBmYWxzZSxcbiAgICB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufSJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFBQSxTQUFTLGdCQUFnQjs7O0FDTWxCLFNBQVMsS0FBSyxNQUFzQjtBQUN6QyxRQUFNLElBQUksUUFBUSxJQUFJLElBQUk7QUFDMUIsTUFBSSxDQUFDLEVBQUcsT0FBTSxJQUFJLE1BQU0sb0JBQW9CLElBQUksRUFBRTtBQUNsRCxTQUFPO0FBQ1Q7QUFFTyxTQUFTLElBQUksTUFBYyxXQUFXLElBQVk7QUFDdkQsU0FBTyxRQUFRLElBQUksSUFBSSxLQUFLO0FBQzlCOzs7QUNaQSxTQUFTLGtCQUFrQixLQUFvRTtBQUM3RixNQUFJLGdCQUFnQixLQUFLLEdBQUcsR0FBRztBQUM3QixXQUFPO0FBQUEsTUFDTCxVQUFVO0FBQUEsTUFDVixTQUFTLEVBQUUsZ0JBQWdCLG1CQUFtQjtBQUFBLElBQ2hEO0FBQUEsRUFDRjtBQUVBLE1BQUksdUJBQXVCLEtBQUssR0FBRyxHQUFHO0FBQ3BDLFVBQU0sU0FBUyxJQUFJLElBQUksR0FBRztBQUMx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
