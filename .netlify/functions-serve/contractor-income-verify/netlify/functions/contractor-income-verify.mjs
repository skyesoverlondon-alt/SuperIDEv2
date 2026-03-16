
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/contractor-income-verify.ts
import crypto4 from "crypto";

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

// netlify/functions/_shared/contractor-admin.ts
import crypto from "crypto";

// netlify/functions/_shared/contractor-network.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function clampString(value, maxLength) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}
function isUuidLike(value) {
  return UUID_RE.test(String(value || "").trim());
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

// netlify/functions/_shared/contractor-admin.ts
function base64urlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlDecode(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
}
function hmacSha256(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest();
}
function parseBool(value) {
  return String(value || "").trim().toLowerCase() === "true";
}
function parseAllowlist(value) {
  return String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}
function createHttpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}
function contractorJson(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}
function contractorErrorResponse(error, fallbackMessage) {
  const message = String(error?.message || fallbackMessage);
  const statusCode = Number(error?.statusCode || 500);
  return contractorJson(statusCode, { error: message });
}
async function verifyContractorAdminJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !secret) return null;
  const [header, body, signature] = parts;
  const message = `${header}.${body}`;
  const expected = base64urlEncode(hmacSha256(secret, message));
  const actual = String(signature || "");
  if (!expected || expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return null;
  try {
    const claims = JSON.parse(base64urlDecode(body).toString("utf-8"));
    const now = Math.floor(Date.now() / 1e3);
    if (claims.exp && now > claims.exp) return null;
    if (claims.role !== "admin") return null;
    return claims;
  } catch {
    return null;
  }
}
async function requireContractorAdmin(request, context) {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const secret = String(process.env.ADMIN_JWT_SECRET || "").trim();
  if (bearer && secret) {
    const claims = await verifyContractorAdminJwt(bearer, secret);
    if (claims?.role === "admin") {
      return {
        actor: claims.sub || "contractor-admin",
        mode: claims.mode === "identity" ? "identity" : "password"
      };
    }
  }
  const identityUser = context?.clientContext?.user;
  if (identityUser) {
    const allowAnyone = parseBool(process.env.ADMIN_IDENTITY_ANYONE);
    const allowlist = parseAllowlist(process.env.ADMIN_EMAIL_ALLOWLIST);
    const email = clampString(identityUser.email, 254).toLowerCase();
    if (allowAnyone || email && allowlist.includes(email)) {
      return { actor: email || "identity-user", mode: "identity" };
    }
    throw createHttpError(403, "Identity user not allowlisted.");
  }
  throw createHttpError(401, "Missing or invalid admin authorization.");
}
async function resolveContractorAdminScope() {
  return resolveContractorIntakeTarget();
}

// netlify/functions/_shared/contractor-income.ts
import crypto2 from "crypto";
function clampString2(value, maxLength) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}
function clampMoney(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}
function safeDate(value) {
  const next = clampString2(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return "";
  return next;
}
function safeUuid(value) {
  const next = clampString2(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(next) ? next : "";
}
async function getContractorHeader(contractorId, orgId) {
  const result = await q(
    `select id, org_id, ws_id, mission_id, full_name, business_name, email, phone, entity_type, status, verified
       from contractor_submissions
      where id=$1
        and org_id=$2
      limit 1`,
    [contractorId, orgId]
  );
  return result.rows[0] || null;
}
async function getVerificationPacket(contractorId, start, end) {
  const result = await q(
    `select *
       from contractor_verification_packets
      where contractor_submission_id=$1
        and period_start=$2
        and period_end=$3
      limit 1`,
    [contractorId, start, end]
  );
  return result.rows[0] || null;
}
async function getSummaryBundle(contractorId, orgId, start, end) {
  const contractor = await getContractorHeader(contractorId, orgId);
  if (!contractor) throw new Error("Contractor not found.");
  const income = await q(
    `select *
       from contractor_income_entries
      where contractor_submission_id=$1
        and entry_date >= $2
        and entry_date <= $3
      order by entry_date desc, created_at desc`,
    [contractorId, start, end]
  );
  const expenses = await q(
    `select *
       from contractor_expense_entries
      where contractor_submission_id=$1
        and entry_date >= $2
        and entry_date <= $3
      order by entry_date desc, created_at desc`,
    [contractorId, start, end]
  );
  const packet = await getVerificationPacket(contractorId, start, end);
  const totals = {
    gross_income: 0,
    fees: 0,
    net_income: 0,
    expenses: 0,
    deductible_expenses: 0,
    net_after_expenses: 0
  };
  for (const row of income.rows) {
    totals.gross_income += Number(row.gross_amount || 0);
    totals.fees += Number(row.fee_amount || 0);
    totals.net_income += Number(row.net_amount || 0);
  }
  for (const row of expenses.rows) {
    const amount = Number(row.amount || 0);
    const deductiblePercent = Number(row.deductible_percent || 0) / 100;
    totals.expenses += amount;
    totals.deductible_expenses += amount * deductiblePercent;
  }
  totals.gross_income = clampMoney(totals.gross_income);
  totals.fees = clampMoney(totals.fees);
  totals.net_income = clampMoney(totals.net_income);
  totals.expenses = clampMoney(totals.expenses);
  totals.deductible_expenses = clampMoney(totals.deductible_expenses);
  totals.net_after_expenses = clampMoney(totals.net_income - totals.expenses);
  const digest = crypto2.createHash("sha256").update(
    JSON.stringify({
      contractor_id: contractorId,
      org_id: orgId,
      start,
      end,
      totals,
      income_count: income.rows.length,
      expense_count: expenses.rows.length
    })
  ).digest("hex");
  return {
    contractor,
    packet,
    income: income.rows,
    expenses: expenses.rows,
    totals,
    digest,
    period: { start, end }
  };
}

// netlify/functions/_shared/sovereign-events.ts
import crypto3 from "crypto";
function inferEventFamily(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  const dot = normalized.indexOf(".");
  return dot === -1 ? normalized : normalized.slice(0, dot);
}
function buildInternalSignature(secret, parts) {
  const hmac = crypto3.createHmac("sha256", secret);
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

// netlify/functions/contractor-income-verify.ts
var contractor_income_verify_default = async (request, context) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "POST") {
      return contractorJson(405, { error: "Method not allowed." });
    }
    const body = await request.json().catch(() => ({}));
    const scope = await resolveContractorAdminScope();
    const contractorSubmissionId = safeUuid(body?.contractor_submission_id);
    const periodStart = safeDate(body?.period_start);
    const periodEnd = safeDate(body?.period_end);
    const status = clampString2(body?.status, 40) || "issued";
    const verificationTier = clampString2(body?.verification_tier, 80) || "company_verified";
    const issuedByName = clampString2(body?.issued_by_name, 120) || "Skyes Over London";
    const issuedByTitle = clampString2(body?.issued_by_title, 120) || "Chief Executive Officer";
    const companyName = clampString2(body?.company_name, 160) || "Skyes Over London";
    const companyEmail = clampString2(body?.company_email, 200) || "SkyesOverLondonLC@solenterprises.org";
    const companyPhone = clampString2(body?.company_phone, 60) || "4804695416";
    const statementText = clampString2(body?.statement_text, 5e3) || "This verification packet reflects contractor activity documented and maintained within the Skyes Over London contractor network platform for the selected reporting window.";
    const packetNotes = clampString2(body?.packet_notes, 3e3);
    if (!contractorSubmissionId) return contractorJson(400, { error: "Missing contractor_submission_id." });
    if (!periodStart || !periodEnd) return contractorJson(400, { error: "Missing period_start or period_end." });
    const bundle = await getSummaryBundle(contractorSubmissionId, scope.orgId, periodStart, periodEnd);
    const packetHash = crypto4.createHash("sha256").update(
      JSON.stringify({
        contractor_submission_id: contractorSubmissionId,
        period_start: periodStart,
        period_end: periodEnd,
        totals: bundle.totals,
        digest: bundle.digest,
        status,
        verification_tier: verificationTier,
        issued_by_name: issuedByName,
        company_name: companyName
      })
    ).digest("hex");
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
        packetHash
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
      verification_tier: verificationTier
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
        verification_tier: verificationTier
      }
    });
    return contractorJson(200, { ok: true, packet, totals: bundle.totals });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to verify contractor financial packet.");
  }
};
export {
  contractor_income_verify_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvY29udHJhY3Rvci1pbmNvbWUtdmVyaWZ5LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvZW52LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvbmVvbi50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2F1ZGl0LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1hZG1pbi50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2NvbnRyYWN0b3ItbmV0d29yay50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2NvbnRyYWN0b3ItaW5jb21lLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvc292ZXJlaWduLWV2ZW50cy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBhdWRpdCB9IGZyb20gXCIuL19zaGFyZWQvYXVkaXRcIjtcbmltcG9ydCB7XG4gIGNvbnRyYWN0b3JFcnJvclJlc3BvbnNlLFxuICBjb250cmFjdG9ySnNvbixcbiAgcmVxdWlyZUNvbnRyYWN0b3JBZG1pbixcbiAgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlLFxufSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItYWRtaW5cIjtcbmltcG9ydCB7IGNsYW1wU3RyaW5nLCBnZXRTdW1tYXJ5QnVuZGxlLCBzYWZlRGF0ZSwgc2FmZVV1aWQgfSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItaW5jb21lXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vX3NoYXJlZC9uZW9uXCI7XG5pbXBvcnQgeyBlbWl0U292ZXJlaWduRXZlbnQgfSBmcm9tIFwiLi9fc2hhcmVkL3NvdmVyZWlnbi1ldmVudHNcIjtcblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHJlcXVlc3Q6IFJlcXVlc3QsIGNvbnRleHQ6IGFueSkgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFkbWluID0gYXdhaXQgcmVxdWlyZUNvbnRyYWN0b3JBZG1pbihyZXF1ZXN0LCBjb250ZXh0KTtcbiAgICBpZiAocmVxdWVzdC5tZXRob2QgIT09IFwiUE9TVFwiKSB7XG4gICAgICByZXR1cm4gY29udHJhY3Rvckpzb24oNDA1LCB7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZC5cIiB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVxdWVzdC5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7XG4gICAgY29uc3Qgc2NvcGUgPSBhd2FpdCByZXNvbHZlQ29udHJhY3RvckFkbWluU2NvcGUoKTtcbiAgICBjb25zdCBjb250cmFjdG9yU3VibWlzc2lvbklkID0gc2FmZVV1aWQoKGJvZHkgYXMgYW55KT8uY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkKTtcbiAgICBjb25zdCBwZXJpb2RTdGFydCA9IHNhZmVEYXRlKChib2R5IGFzIGFueSk/LnBlcmlvZF9zdGFydCk7XG4gICAgY29uc3QgcGVyaW9kRW5kID0gc2FmZURhdGUoKGJvZHkgYXMgYW55KT8ucGVyaW9kX2VuZCk7XG4gICAgY29uc3Qgc3RhdHVzID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8uc3RhdHVzLCA0MCkgfHwgXCJpc3N1ZWRcIjtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25UaWVyID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8udmVyaWZpY2F0aW9uX3RpZXIsIDgwKSB8fCBcImNvbXBhbnlfdmVyaWZpZWRcIjtcbiAgICBjb25zdCBpc3N1ZWRCeU5hbWUgPSBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5pc3N1ZWRfYnlfbmFtZSwgMTIwKSB8fCBcIlNreWVzIE92ZXIgTG9uZG9uXCI7XG4gICAgY29uc3QgaXNzdWVkQnlUaXRsZSA9IGNsYW1wU3RyaW5nKChib2R5IGFzIGFueSk/Lmlzc3VlZF9ieV90aXRsZSwgMTIwKSB8fCBcIkNoaWVmIEV4ZWN1dGl2ZSBPZmZpY2VyXCI7XG4gICAgY29uc3QgY29tcGFueU5hbWUgPSBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5jb21wYW55X25hbWUsIDE2MCkgfHwgXCJTa3llcyBPdmVyIExvbmRvblwiO1xuICAgIGNvbnN0IGNvbXBhbnlFbWFpbCA9IGNsYW1wU3RyaW5nKChib2R5IGFzIGFueSk/LmNvbXBhbnlfZW1haWwsIDIwMCkgfHwgXCJTa3llc092ZXJMb25kb25MQ0Bzb2xlbnRlcnByaXNlcy5vcmdcIjtcbiAgICBjb25zdCBjb21wYW55UGhvbmUgPSBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5jb21wYW55X3Bob25lLCA2MCkgfHwgXCI0ODA0Njk1NDE2XCI7XG4gICAgY29uc3Qgc3RhdGVtZW50VGV4dCA9XG4gICAgICBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5zdGF0ZW1lbnRfdGV4dCwgNTAwMCkgfHxcbiAgICAgIFwiVGhpcyB2ZXJpZmljYXRpb24gcGFja2V0IHJlZmxlY3RzIGNvbnRyYWN0b3IgYWN0aXZpdHkgZG9jdW1lbnRlZCBhbmQgbWFpbnRhaW5lZCB3aXRoaW4gdGhlIFNreWVzIE92ZXIgTG9uZG9uIGNvbnRyYWN0b3IgbmV0d29yayBwbGF0Zm9ybSBmb3IgdGhlIHNlbGVjdGVkIHJlcG9ydGluZyB3aW5kb3cuXCI7XG4gICAgY29uc3QgcGFja2V0Tm90ZXMgPSBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5wYWNrZXRfbm90ZXMsIDMwMDApO1xuXG4gICAgaWYgKCFjb250cmFjdG9yU3VibWlzc2lvbklkKSByZXR1cm4gY29udHJhY3Rvckpzb24oNDAwLCB7IGVycm9yOiBcIk1pc3NpbmcgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkLlwiIH0pO1xuICAgIGlmICghcGVyaW9kU3RhcnQgfHwgIXBlcmlvZEVuZCkgcmV0dXJuIGNvbnRyYWN0b3JKc29uKDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHBlcmlvZF9zdGFydCBvciBwZXJpb2RfZW5kLlwiIH0pO1xuXG4gICAgY29uc3QgYnVuZGxlID0gYXdhaXQgZ2V0U3VtbWFyeUJ1bmRsZShjb250cmFjdG9yU3VibWlzc2lvbklkLCBzY29wZS5vcmdJZCwgcGVyaW9kU3RhcnQsIHBlcmlvZEVuZCk7XG4gICAgY29uc3QgcGFja2V0SGFzaCA9IGNyeXB0b1xuICAgICAgLmNyZWF0ZUhhc2goXCJzaGEyNTZcIilcbiAgICAgIC51cGRhdGUoXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBjb250cmFjdG9yX3N1Ym1pc3Npb25faWQ6IGNvbnRyYWN0b3JTdWJtaXNzaW9uSWQsXG4gICAgICAgICAgcGVyaW9kX3N0YXJ0OiBwZXJpb2RTdGFydCxcbiAgICAgICAgICBwZXJpb2RfZW5kOiBwZXJpb2RFbmQsXG4gICAgICAgICAgdG90YWxzOiBidW5kbGUudG90YWxzLFxuICAgICAgICAgIGRpZ2VzdDogYnVuZGxlLmRpZ2VzdCxcbiAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgdmVyaWZpY2F0aW9uX3RpZXI6IHZlcmlmaWNhdGlvblRpZXIsXG4gICAgICAgICAgaXNzdWVkX2J5X25hbWU6IGlzc3VlZEJ5TmFtZSxcbiAgICAgICAgICBjb21wYW55X25hbWU6IGNvbXBhbnlOYW1lLFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmRpZ2VzdChcImhleFwiKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHEoXG4gICAgICBgaW5zZXJ0IGludG8gY29udHJhY3Rvcl92ZXJpZmljYXRpb25fcGFja2V0cyhcbiAgICAgICAgIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZCwgcGVyaW9kX3N0YXJ0LCBwZXJpb2RfZW5kLFxuICAgICAgICAgc3RhdHVzLCB2ZXJpZmljYXRpb25fdGllciwgaXNzdWVkX2J5X25hbWUsIGlzc3VlZF9ieV90aXRsZSxcbiAgICAgICAgIGNvbXBhbnlfbmFtZSwgY29tcGFueV9lbWFpbCwgY29tcGFueV9waG9uZSxcbiAgICAgICAgIHN0YXRlbWVudF90ZXh0LCBwYWNrZXRfbm90ZXMsIHBhY2tldF9oYXNoXG4gICAgICAgKVxuICAgICAgIHZhbHVlcygkMSwkMiwkMywkNCwkNSwkNiwkNywkOCwkOSwkMTAsJDExLCQxMiwkMTMpXG4gICAgICAgb24gY29uZmxpY3QgKGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZCwgcGVyaW9kX3N0YXJ0LCBwZXJpb2RfZW5kKVxuICAgICAgIGRvIHVwZGF0ZSBzZXRcbiAgICAgICAgIHN0YXR1cz1leGNsdWRlZC5zdGF0dXMsXG4gICAgICAgICB2ZXJpZmljYXRpb25fdGllcj1leGNsdWRlZC52ZXJpZmljYXRpb25fdGllcixcbiAgICAgICAgIGlzc3VlZF9ieV9uYW1lPWV4Y2x1ZGVkLmlzc3VlZF9ieV9uYW1lLFxuICAgICAgICAgaXNzdWVkX2J5X3RpdGxlPWV4Y2x1ZGVkLmlzc3VlZF9ieV90aXRsZSxcbiAgICAgICAgIGNvbXBhbnlfbmFtZT1leGNsdWRlZC5jb21wYW55X25hbWUsXG4gICAgICAgICBjb21wYW55X2VtYWlsPWV4Y2x1ZGVkLmNvbXBhbnlfZW1haWwsXG4gICAgICAgICBjb21wYW55X3Bob25lPWV4Y2x1ZGVkLmNvbXBhbnlfcGhvbmUsXG4gICAgICAgICBzdGF0ZW1lbnRfdGV4dD1leGNsdWRlZC5zdGF0ZW1lbnRfdGV4dCxcbiAgICAgICAgIHBhY2tldF9ub3Rlcz1leGNsdWRlZC5wYWNrZXRfbm90ZXMsXG4gICAgICAgICBwYWNrZXRfaGFzaD1leGNsdWRlZC5wYWNrZXRfaGFzaCxcbiAgICAgICAgIHVwZGF0ZWRfYXQ9bm93KClcbiAgICAgICByZXR1cm5pbmcgKmAsXG4gICAgICBbXG4gICAgICAgIGNvbnRyYWN0b3JTdWJtaXNzaW9uSWQsXG4gICAgICAgIHBlcmlvZFN0YXJ0LFxuICAgICAgICBwZXJpb2RFbmQsXG4gICAgICAgIHN0YXR1cyxcbiAgICAgICAgdmVyaWZpY2F0aW9uVGllcixcbiAgICAgICAgaXNzdWVkQnlOYW1lLFxuICAgICAgICBpc3N1ZWRCeVRpdGxlLFxuICAgICAgICBjb21wYW55TmFtZSxcbiAgICAgICAgY29tcGFueUVtYWlsLFxuICAgICAgICBjb21wYW55UGhvbmUsXG4gICAgICAgIHN0YXRlbWVudFRleHQsXG4gICAgICAgIHBhY2tldE5vdGVzIHx8IFwiXCIsXG4gICAgICAgIHBhY2tldEhhc2gsXG4gICAgICBdXG4gICAgKTtcblxuICAgIGNvbnN0IHBhY2tldCA9IHJlc3VsdC5yb3dzWzBdIHx8IG51bGw7XG4gICAgYXdhaXQgYXVkaXQoYWRtaW4uYWN0b3IsIHNjb3BlLm9yZ0lkLCBidW5kbGUuY29udHJhY3Rvci53c19pZCB8fCBudWxsLCBcImNvbnRyYWN0b3IuZmluYW5jZS5wYWNrZXQudmVyaWZ5XCIsIHtcbiAgICAgIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZDogY29udHJhY3RvclN1Ym1pc3Npb25JZCxcbiAgICAgIG1pc3Npb25faWQ6IGJ1bmRsZS5jb250cmFjdG9yLm1pc3Npb25faWQgfHwgbnVsbCxcbiAgICAgIHBlcmlvZF9zdGFydDogcGVyaW9kU3RhcnQsXG4gICAgICBwZXJpb2RfZW5kOiBwZXJpb2RFbmQsXG4gICAgICBwYWNrZXRfaGFzaDogcGFja2V0SGFzaCxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHZlcmlmaWNhdGlvbl90aWVyOiB2ZXJpZmljYXRpb25UaWVyLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgZW1pdFNvdmVyZWlnbkV2ZW50KHtcbiAgICAgIGFjdG9yOiBhZG1pbi5hY3RvcixcbiAgICAgIG9yZ0lkOiBzY29wZS5vcmdJZCxcbiAgICAgIHdzSWQ6IGJ1bmRsZS5jb250cmFjdG9yLndzX2lkIHx8IG51bGwsXG4gICAgICBtaXNzaW9uSWQ6IGJ1bmRsZS5jb250cmFjdG9yLm1pc3Npb25faWQgfHwgbnVsbCxcbiAgICAgIGV2ZW50VHlwZTogXCJjb250cmFjdG9yLmZpbmFuY2UucGFja2V0LnZlcmlmaWVkXCIsXG4gICAgICBzb3VyY2VBcHA6IFwiQ29udHJhY3RvckluY29tZVZlcmlmaWNhdGlvblwiLFxuICAgICAgc291cmNlUm91dGU6IFwiL2FwaS9jb250cmFjdG9yLWluY29tZS12ZXJpZnlcIixcbiAgICAgIHN1YmplY3RLaW5kOiBcImNvbnRyYWN0b3Jfc3VibWlzc2lvblwiLFxuICAgICAgc3ViamVjdElkOiBjb250cmFjdG9yU3VibWlzc2lvbklkLFxuICAgICAgc3VtbWFyeTogYFZlcmlmaWNhdGlvbiBwYWNrZXQgdXBkYXRlZCBmb3IgJHtidW5kbGUuY29udHJhY3Rvci5mdWxsX25hbWUgfHwgYnVuZGxlLmNvbnRyYWN0b3IuZW1haWwgfHwgY29udHJhY3RvclN1Ym1pc3Npb25JZH1gLFxuICAgICAgcGF5bG9hZDoge1xuICAgICAgICBwYWNrZXRfaWQ6IHBhY2tldD8uaWQgfHwgbnVsbCxcbiAgICAgICAgcGVyaW9kX3N0YXJ0OiBwZXJpb2RTdGFydCxcbiAgICAgICAgcGVyaW9kX2VuZDogcGVyaW9kRW5kLFxuICAgICAgICBwYWNrZXRfaGFzaDogcGFja2V0SGFzaCxcbiAgICAgICAgc3RhdHVzLFxuICAgICAgICB2ZXJpZmljYXRpb25fdGllcjogdmVyaWZpY2F0aW9uVGllcixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29udHJhY3Rvckpzb24oMjAwLCB7IG9rOiB0cnVlLCBwYWNrZXQsIHRvdGFsczogYnVuZGxlLnRvdGFscyB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gY29udHJhY3RvckVycm9yUmVzcG9uc2UoZXJyb3IsIFwiRmFpbGVkIHRvIHZlcmlmeSBjb250cmFjdG9yIGZpbmFuY2lhbCBwYWNrZXQuXCIpO1xuICB9XG59OyIsICIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIGhlbHBlcnMgZm9yIE5ldGxpZnkgZnVuY3Rpb25zLiAgVXNlIG11c3QoKVxuICogd2hlbiBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZDsgaXQgdGhyb3dzIGFuIGVycm9yXG4gKiBpbnN0ZWFkIG9mIHJldHVybmluZyB1bmRlZmluZWQuICBVc2Ugb3B0KCkgZm9yIG9wdGlvbmFsIHZhbHVlc1xuICogd2l0aCBhbiBvcHRpb25hbCBmYWxsYmFjay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG11c3QobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdiA9IHByb2Nlc3MuZW52W25hbWVdO1xuICBpZiAoIXYpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBlbnYgdmFyOiAke25hbWV9YCk7XG4gIHJldHVybiB2O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gb3B0KG5hbWU6IHN0cmluZywgZmFsbGJhY2sgPSBcIlwiKTogc3RyaW5nIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52W25hbWVdIHx8IGZhbGxiYWNrO1xufSIsICJpbXBvcnQgeyBtdXN0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmZ1bmN0aW9uIHRvSHR0cFNxbEVuZHBvaW50KHVybDogc3RyaW5nKTogeyBlbmRwb2ludDogc3RyaW5nOyBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0ge1xuICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50OiB1cmwsXG4gICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmICgvXnBvc3RncmVzKHFsKT86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTCh1cmwpO1xuICAgIGNvbnN0IGVuZHBvaW50ID0gYGh0dHBzOi8vJHtwYXJzZWQuaG9zdH0vc3FsYDtcbiAgICByZXR1cm4ge1xuICAgICAgZW5kcG9pbnQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIk5lb24tQ29ubmVjdGlvbi1TdHJpbmdcIjogdXJsLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiTkVPTl9EQVRBQkFTRV9VUkwgbXVzdCBiZSBhbiBodHRwcyBTUUwgZW5kcG9pbnQgb3IgcG9zdGdyZXMgY29ubmVjdGlvbiBzdHJpbmcuXCIpO1xufVxuXG4vKipcbiAqIEV4ZWN1dGUgYSBTUUwgcXVlcnkgYWdhaW5zdCB0aGUgTmVvbiBzZXJ2ZXJsZXNzIGRhdGFiYXNlIHZpYSB0aGVcbiAqIEhUVFAgZW5kcG9pbnQuICBUaGUgTkVPTl9EQVRBQkFTRV9VUkwgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdFxuICogYmUgc2V0IHRvIGEgdmFsaWQgTmVvbiBTUUwtb3Zlci1IVFRQIGVuZHBvaW50LiAgUmV0dXJucyB0aGVcbiAqIHBhcnNlZCBKU09OIHJlc3VsdCB3aGljaCBpbmNsdWRlcyBhICdyb3dzJyBhcnJheS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHEoc3FsOiBzdHJpbmcsIHBhcmFtczogYW55W10gPSBbXSkge1xuICBjb25zdCB1cmwgPSBtdXN0KFwiTkVPTl9EQVRBQkFTRV9VUkxcIik7XG4gIGNvbnN0IHRhcmdldCA9IHRvSHR0cFNxbEVuZHBvaW50KHVybCk7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRhcmdldC5lbmRwb2ludCwge1xuICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgaGVhZGVyczogdGFyZ2V0LmhlYWRlcnMsXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogc3FsLCBwYXJhbXMgfSksXG4gIH0pO1xuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICAgIHRocm93IG5ldyBFcnJvcihgREIgZXJyb3I6ICR7dGV4dH1gKTtcbiAgfVxuICByZXR1cm4gcmVzLmpzb24oKSBhcyBQcm9taXNlPHsgcm93czogYW55W10gfT47XG59IiwgImltcG9ydCB7IHEgfSBmcm9tIFwiLi9uZW9uXCI7XG5cbi8qKlxuICogUmVjb3JkIGFuIGF1ZGl0IGV2ZW50IGluIHRoZSBkYXRhYmFzZS4gIEFsbCBjb25zZXF1ZW50aWFsXG4gKiBvcGVyYXRpb25zIHNob3VsZCBlbWl0IGFuIGF1ZGl0IGV2ZW50IHdpdGggYWN0b3IsIG9yZywgd29ya3NwYWNlLFxuICogdHlwZSBhbmQgYXJiaXRyYXJ5IG1ldGFkYXRhLiAgRXJyb3JzIGFyZSBzd2FsbG93ZWQgc2lsZW50bHlcbiAqIGJlY2F1c2UgYXVkaXQgbG9nZ2luZyBtdXN0IG5ldmVyIGJyZWFrIHVzZXIgZmxvd3MuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhdWRpdChcbiAgYWN0b3I6IHN0cmluZyxcbiAgb3JnX2lkOiBzdHJpbmcgfCBudWxsLFxuICB3c19pZDogc3RyaW5nIHwgbnVsbCxcbiAgdHlwZTogc3RyaW5nLFxuICBtZXRhOiBhbnlcbikge1xuICB0cnkge1xuICAgIGF3YWl0IHEoXG4gICAgICBcImluc2VydCBpbnRvIGF1ZGl0X2V2ZW50cyhhY3Rvciwgb3JnX2lkLCB3c19pZCwgdHlwZSwgbWV0YSkgdmFsdWVzKCQxLCQyLCQzLCQ0LCQ1Ojpqc29uYilcIixcbiAgICAgIFthY3Rvciwgb3JnX2lkLCB3c19pZCwgdHlwZSwgSlNPTi5zdHJpbmdpZnkobWV0YSA/PyB7fSldXG4gICAgKTtcbiAgfSBjYXRjaCAoXykge1xuICAgIC8vIGlnbm9yZSBhdWRpdCBmYWlsdXJlc1xuICB9XG59IiwgImltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcbmltcG9ydCB7IGNsYW1wQXJyYXksIGNsYW1wU3RyaW5nLCByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCB9IGZyb20gXCIuL2NvbnRyYWN0b3ItbmV0d29ya1wiO1xuXG50eXBlIEFkbWluQ2xhaW1zID0ge1xuICByb2xlOiBcImFkbWluXCI7XG4gIHN1Yjogc3RyaW5nO1xuICBtb2RlPzogXCJwYXNzd29yZFwiIHwgXCJpZGVudGl0eVwiO1xuICBpYXQ/OiBudW1iZXI7XG4gIGV4cD86IG51bWJlcjtcbn07XG5cbnR5cGUgQWRtaW5QcmluY2lwYWwgPSB7XG4gIGFjdG9yOiBzdHJpbmc7XG4gIG1vZGU6IFwicGFzc3dvcmRcIiB8IFwiaWRlbnRpdHlcIjtcbn07XG5cbmZ1bmN0aW9uIGJhc2U2NHVybEVuY29kZShpbnB1dDogQnVmZmVyIHwgc3RyaW5nKSB7XG4gIHJldHVybiBCdWZmZXIuZnJvbShpbnB1dClcbiAgICAudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICAucmVwbGFjZSgvPS9nLCBcIlwiKVxuICAgIC5yZXBsYWNlKC9cXCsvZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL1xcLy9nLCBcIl9cIik7XG59XG5cbmZ1bmN0aW9uIGJhc2U2NHVybERlY29kZShpbnB1dDogc3RyaW5nKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBTdHJpbmcoaW5wdXQgfHwgXCJcIikucmVwbGFjZSgvLS9nLCBcIitcIikucmVwbGFjZSgvXy9nLCBcIi9cIik7XG4gIGNvbnN0IHBhZGRlZCA9IG5vcm1hbGl6ZWQgKyBcIj1cIi5yZXBlYXQoKDQgLSAobm9ybWFsaXplZC5sZW5ndGggJSA0IHx8IDQpKSAlIDQpO1xuICByZXR1cm4gQnVmZmVyLmZyb20ocGFkZGVkLCBcImJhc2U2NFwiKTtcbn1cblxuZnVuY3Rpb24gaG1hY1NoYTI1NihzZWNyZXQ6IHN0cmluZywgcGF5bG9hZDogc3RyaW5nKSB7XG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSG1hYyhcInNoYTI1NlwiLCBzZWNyZXQpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCb29sKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCkgPT09IFwidHJ1ZVwiO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsbG93bGlzdCh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlSHR0cEVycm9yKHN0YXR1czogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpIHtcbiAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IobWVzc2FnZSkgYXMgRXJyb3IgJiB7IHN0YXR1c0NvZGU/OiBudW1iZXIgfTtcbiAgZXJyb3Iuc3RhdHVzQ29kZSA9IHN0YXR1cztcbiAgcmV0dXJuIGVycm9yO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29udHJhY3Rvckpzb24oc3RhdHVzOiBudW1iZXIsIGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBleHRyYUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGJvZHkpLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tc3RvcmVcIixcbiAgICAgIC4uLmV4dHJhSGVhZGVycyxcbiAgICB9LFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnRyYWN0b3JFcnJvclJlc3BvbnNlKGVycm9yOiB1bmtub3duLCBmYWxsYmFja01lc3NhZ2U6IHN0cmluZykge1xuICBjb25zdCBtZXNzYWdlID0gU3RyaW5nKChlcnJvciBhcyBhbnkpPy5tZXNzYWdlIHx8IGZhbGxiYWNrTWVzc2FnZSk7XG4gIGNvbnN0IHN0YXR1c0NvZGUgPSBOdW1iZXIoKGVycm9yIGFzIGFueSk/LnN0YXR1c0NvZGUgfHwgNTAwKTtcbiAgcmV0dXJuIGNvbnRyYWN0b3JKc29uKHN0YXR1c0NvZGUsIHsgZXJyb3I6IG1lc3NhZ2UgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTdGF0dXModmFsdWU6IHVua25vd24pIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgYWxsb3dlZCA9IG5ldyBTZXQoW1wibmV3XCIsIFwicmV2aWV3aW5nXCIsIFwiYXBwcm92ZWRcIiwgXCJvbl9ob2xkXCIsIFwicmVqZWN0ZWRcIl0pO1xuICByZXR1cm4gYWxsb3dlZC5oYXMobm9ybWFsaXplZCkgPyBub3JtYWxpemVkIDogXCJyZXZpZXdpbmdcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVRhZ3ModmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wQXJyYXkodmFsdWUsIDIwLCA0OCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaWduQ29udHJhY3RvckFkbWluSnd0KFxuICBwYXlsb2FkOiBQaWNrPEFkbWluQ2xhaW1zLCBcInJvbGVcIiB8IFwic3ViXCIgfCBcIm1vZGVcIj4sXG4gIHNlY3JldDogc3RyaW5nLFxuICBleHBpcmVzSW5TZWNvbmRzID0gNjAgKiA2MCAqIDEyXG4pIHtcbiAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gIGNvbnN0IGhlYWRlciA9IGJhc2U2NHVybEVuY29kZShKU09OLnN0cmluZ2lmeSh7IGFsZzogXCJIUzI1NlwiLCB0eXA6IFwiSldUXCIgfSkpO1xuICBjb25zdCBjbGFpbXM6IEFkbWluQ2xhaW1zID0ge1xuICAgIC4uLnBheWxvYWQsXG4gICAgaWF0OiBub3csXG4gICAgZXhwOiBub3cgKyBleHBpcmVzSW5TZWNvbmRzLFxuICB9O1xuICBjb25zdCBib2R5ID0gYmFzZTY0dXJsRW5jb2RlKEpTT04uc3RyaW5naWZ5KGNsYWltcykpO1xuICBjb25zdCBtZXNzYWdlID0gYCR7aGVhZGVyfS4ke2JvZHl9YDtcbiAgY29uc3Qgc2lnbmF0dXJlID0gYmFzZTY0dXJsRW5jb2RlKGhtYWNTaGEyNTYoc2VjcmV0LCBtZXNzYWdlKSk7XG4gIHJldHVybiBgJHttZXNzYWdlfS4ke3NpZ25hdHVyZX1gO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5Q29udHJhY3RvckFkbWluSnd0KHRva2VuOiBzdHJpbmcsIHNlY3JldDogc3RyaW5nKSB7XG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKHRva2VuIHx8IFwiXCIpLnNwbGl0KFwiLlwiKTtcbiAgaWYgKHBhcnRzLmxlbmd0aCAhPT0gMyB8fCAhc2VjcmV0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgW2hlYWRlciwgYm9keSwgc2lnbmF0dXJlXSA9IHBhcnRzO1xuICBjb25zdCBtZXNzYWdlID0gYCR7aGVhZGVyfS4ke2JvZHl9YDtcbiAgY29uc3QgZXhwZWN0ZWQgPSBiYXNlNjR1cmxFbmNvZGUoaG1hY1NoYTI1NihzZWNyZXQsIG1lc3NhZ2UpKTtcbiAgY29uc3QgYWN0dWFsID0gU3RyaW5nKHNpZ25hdHVyZSB8fCBcIlwiKTtcbiAgaWYgKCFleHBlY3RlZCB8fCBleHBlY3RlZC5sZW5ndGggIT09IGFjdHVhbC5sZW5ndGgpIHJldHVybiBudWxsO1xuICBpZiAoIWNyeXB0by50aW1pbmdTYWZlRXF1YWwoQnVmZmVyLmZyb20oZXhwZWN0ZWQpLCBCdWZmZXIuZnJvbShhY3R1YWwpKSkgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3QgY2xhaW1zID0gSlNPTi5wYXJzZShiYXNlNjR1cmxEZWNvZGUoYm9keSkudG9TdHJpbmcoXCJ1dGYtOFwiKSkgYXMgQWRtaW5DbGFpbXM7XG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gICAgaWYgKGNsYWltcy5leHAgJiYgbm93ID4gY2xhaW1zLmV4cCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKGNsYWltcy5yb2xlICE9PSBcImFkbWluXCIpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBjbGFpbXM7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1aXJlQ29udHJhY3RvckFkbWluKHJlcXVlc3Q6IFJlcXVlc3QsIGNvbnRleHQ/OiBhbnkpOiBQcm9taXNlPEFkbWluUHJpbmNpcGFsPiB7XG4gIGNvbnN0IGF1dGggPSByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiYXV0aG9yaXphdGlvblwiKSB8fCByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiQXV0aG9yaXphdGlvblwiKSB8fCBcIlwiO1xuICBjb25zdCBiZWFyZXIgPSBhdXRoLnN0YXJ0c1dpdGgoXCJCZWFyZXIgXCIpID8gYXV0aC5zbGljZShcIkJlYXJlciBcIi5sZW5ndGgpLnRyaW0oKSA6IFwiXCI7XG4gIGNvbnN0IHNlY3JldCA9IFN0cmluZyhwcm9jZXNzLmVudi5BRE1JTl9KV1RfU0VDUkVUIHx8IFwiXCIpLnRyaW0oKTtcblxuICBpZiAoYmVhcmVyICYmIHNlY3JldCkge1xuICAgIGNvbnN0IGNsYWltcyA9IGF3YWl0IHZlcmlmeUNvbnRyYWN0b3JBZG1pbkp3dChiZWFyZXIsIHNlY3JldCk7XG4gICAgaWYgKGNsYWltcz8ucm9sZSA9PT0gXCJhZG1pblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3RvcjogY2xhaW1zLnN1YiB8fCBcImNvbnRyYWN0b3ItYWRtaW5cIixcbiAgICAgICAgbW9kZTogY2xhaW1zLm1vZGUgPT09IFwiaWRlbnRpdHlcIiA/IFwiaWRlbnRpdHlcIiA6IFwicGFzc3dvcmRcIixcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaWRlbnRpdHlVc2VyID0gY29udGV4dD8uY2xpZW50Q29udGV4dD8udXNlcjtcbiAgaWYgKGlkZW50aXR5VXNlcikge1xuICAgIGNvbnN0IGFsbG93QW55b25lID0gcGFyc2VCb29sKHByb2Nlc3MuZW52LkFETUlOX0lERU5USVRZX0FOWU9ORSk7XG4gICAgY29uc3QgYWxsb3dsaXN0ID0gcGFyc2VBbGxvd2xpc3QocHJvY2Vzcy5lbnYuQURNSU5fRU1BSUxfQUxMT1dMSVNUKTtcbiAgICBjb25zdCBlbWFpbCA9IGNsYW1wU3RyaW5nKGlkZW50aXR5VXNlci5lbWFpbCwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChhbGxvd0FueW9uZSB8fCAoZW1haWwgJiYgYWxsb3dsaXN0LmluY2x1ZGVzKGVtYWlsKSkpIHtcbiAgICAgIHJldHVybiB7IGFjdG9yOiBlbWFpbCB8fCBcImlkZW50aXR5LXVzZXJcIiwgbW9kZTogXCJpZGVudGl0eVwiIH07XG4gICAgfVxuICAgIHRocm93IGNyZWF0ZUh0dHBFcnJvcig0MDMsIFwiSWRlbnRpdHkgdXNlciBub3QgYWxsb3dsaXN0ZWQuXCIpO1xuICB9XG5cbiAgdGhyb3cgY3JlYXRlSHR0cEVycm9yKDQwMSwgXCJNaXNzaW5nIG9yIGludmFsaWQgYWRtaW4gYXV0aG9yaXphdGlvbi5cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29udHJhY3RvclF1ZXJ5TGltaXQocmF3OiBzdHJpbmcgfCBudWxsLCBmYWxsYmFjayA9IDEwMCwgbWF4ID0gMjAwKSB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlcihyYXcgfHwgZmFsbGJhY2spO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gZmFsbGJhY2s7XG4gIHJldHVybiBNYXRoLm1heCgxLCBNYXRoLm1pbihtYXgsIE1hdGgudHJ1bmMocGFyc2VkKSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplQ29udHJhY3RvckxhbmVzKHJhdzogdW5rbm93bikge1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gcmF3Lm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0gfHwgXCJcIikudHJpbSgpKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQubWFwKChpdGVtKSA9PiBTdHJpbmcoaXRlbSB8fCBcIlwiKS50cmltKCkpLmZpbHRlcihCb29sZWFuKSA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW10gYXMgc3RyaW5nW107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDb250cmFjdG9yVGFncyhyYXc6IHVua25vd24pIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhdy5tYXAoKGl0ZW0pID0+IFN0cmluZyhpdGVtIHx8IFwiXCIpLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgfVxuICByZXR1cm4gW10gYXMgc3RyaW5nW107XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckFkbWluU2NvcGUoKSB7XG4gIHJldHVybiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29udHJhY3RvckhlYWx0aFByb2JlKCkge1xuICBhd2FpdCBxKFwic2VsZWN0IDEgYXMgb25lXCIsIFtdKTtcbn1cbiIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuaW1wb3J0IHsgb3B0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmV4cG9ydCB0eXBlIENvbnRyYWN0b3JJbnRha2VUYXJnZXQgPSB7XG4gIG9yZ0lkOiBzdHJpbmc7XG4gIHdzSWQ6IHN0cmluZyB8IG51bGw7XG4gIG1pc3Npb25JZDogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmNvbnN0IFVVSURfUkUgPSAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLTVdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBBcnJheShpbnB1dDogdW5rbm93biwgbGltaXQ6IG51bWJlciwgbWF4TGVuZ3RoOiBudW1iZXIpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGlucHV0KSkgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xuICByZXR1cm4gaW5wdXRcbiAgICAubWFwKChpdGVtKSA9PiBjbGFtcFN0cmluZyhpdGVtLCBtYXhMZW5ndGgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAuc2xpY2UoMCwgbGltaXQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZUVtYWlsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIW5leHQgfHwgIW5leHQuaW5jbHVkZXMoXCJAXCIpIHx8IG5leHQuaW5jbHVkZXMoXCIgXCIpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlUGhvbmUodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkucmVwbGFjZSgvW15cXGQrXFwtKCkgXS9nLCBcIlwiKS5zbGljZSgwLCA0MCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNTAwKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG5leHQpO1xuICAgIGlmIChwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cDpcIiAmJiBwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cHM6XCIpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSnNvbkxpc3QodmFsdWU6IHVua25vd24sIGxpbWl0OiBudW1iZXIpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gY2xhbXBBcnJheSh2YWx1ZSwgbGltaXQsIDgwKTtcbiAgY29uc3QgcmF3ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXSBhcyBzdHJpbmdbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgcmV0dXJuIGNsYW1wQXJyYXkocGFyc2VkLCBsaW1pdCwgODApO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW10gYXMgc3RyaW5nW107XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVGaWxlbmFtZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDE4MCkgfHwgXCJmaWxlXCI7XG4gIHJldHVybiBuZXh0LnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1V1aWRMaWtlKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBVVUlEX1JFLnRlc3QoU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29ycmVsYXRpb25JZEZyb21IZWFkZXJzKGhlYWRlcnM6IEhlYWRlcnMpIHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBoZWFkZXJzLmdldChcIngtY29ycmVsYXRpb24taWRcIiksXG4gICAgaGVhZGVycy5nZXQoXCJYLUNvcnJlbGF0aW9uLUlkXCIpLFxuICAgIGhlYWRlcnMuZ2V0KFwieF9jb3JyZWxhdGlvbl9pZFwiKSxcbiAgXTtcbiAgY29uc3QgdmFsdWUgPSBjbGFtcFN0cmluZyhjYW5kaWRhdGVzLmZpbmQoQm9vbGVhbiksIDEyOCk7XG4gIGlmICghdmFsdWUpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvW15hLXpBLVowLTk6X1xcLS5dL2csIFwiXCIpLnNsaWNlKDAsIDEyOCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpIHtcbiAgY29uc3Qgb3JnSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfT1JHX0lEXCIpLCA2NCk7XG4gIGNvbnN0IHdzSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfV1NfSURcIiksIDY0KSB8fCBudWxsO1xuICBjb25zdCBtaXNzaW9uSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRFwiKSwgNjQpIHx8IG51bGw7XG5cbiAgaWYgKCFvcmdJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3IgTmV0d29yayBpbnRha2UgaXMgbm90IGNvbmZpZ3VyZWQuIE1pc3NpbmcgQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gIH1cblxuICBpZiAoIWlzVXVpZExpa2Uob3JnSWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gIH1cblxuICBpZiAod3NJZCkge1xuICAgIGlmICghaXNVdWlkTGlrZSh3c0lkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3Qgd3MgPSBhd2FpdCBxKFwic2VsZWN0IGlkIGZyb20gd29ya3NwYWNlcyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIiwgW3dzSWQsIG9yZ0lkXSk7XG4gICAgaWYgKCF3cy5yb3dzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIGRvZXMgbm90IGJlbG9uZyB0byBDT05UUkFDVE9SX05FVFdPUktfT1JHX0lELlwiKTtcbiAgICB9XG4gIH1cblxuICBpZiAobWlzc2lvbklkKSB7XG4gICAgaWYgKCFpc1V1aWRMaWtlKG1pc3Npb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19NSVNTSU9OX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3QgbWlzc2lvbiA9IGF3YWl0IHEoXG4gICAgICBcInNlbGVjdCBpZCwgd3NfaWQgZnJvbSBtaXNzaW9ucyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIixcbiAgICAgIFttaXNzaW9uSWQsIG9yZ0lkXVxuICAgICk7XG4gICAgaWYgKCFtaXNzaW9uLnJvd3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRCBkb2VzIG5vdCBiZWxvbmcgdG8gQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBvcmdJZCxcbiAgICAgIHdzSWQ6IHdzSWQgfHwgbWlzc2lvbi5yb3dzWzBdPy53c19pZCB8fCBudWxsLFxuICAgICAgbWlzc2lvbklkLFxuICAgIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG4gIH1cblxuICByZXR1cm4geyBvcmdJZCwgd3NJZCwgbWlzc2lvbklkOiBudWxsIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG59XG4iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBNb25leSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUgfHwgMCk7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiAwO1xuICByZXR1cm4gTWF0aC5yb3VuZChwYXJzZWQgKiAxMDApIC8gMTAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDUwMCk7XG4gIGlmICghbmV4dCkgcmV0dXJuIFwiXCI7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChuZXh0KTtcbiAgICBpZiAoIVtcImh0dHA6XCIsIFwiaHR0cHM6XCJdLmluY2x1ZGVzKHBhcnNlZC5wcm90b2NvbCkpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVEYXRlKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjApO1xuICBpZiAoIS9eXFxkezR9LVxcZHsyfS1cXGR7Mn0kLy50ZXN0KG5leHQpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXVpZCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDY0KTtcbiAgcmV0dXJuIC9eWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzEtNV1bMC05YS1mXXszfS1bODlhYl1bMC05YS1mXXszfS1bMC05YS1mXXsxMn0kL2kudGVzdChuZXh0KSA/IG5leHQgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3N2RXNjYXBlKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IHJhdyA9IFN0cmluZyh2YWx1ZSA/PyBcIlwiKTtcbiAgY29uc3QgZXNjYXBlZCA9IHJhdy5yZXBsYWNlKC9cIi9nLCAnXCJcIicpO1xuICByZXR1cm4gL1tcIixcXG5dLy50ZXN0KHJhdykgPyBgXCIke2VzY2FwZWR9XCJgIDogZXNjYXBlZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnRyYWN0b3JIZWFkZXIoY29udHJhY3RvcklkOiBzdHJpbmcsIG9yZ0lkOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcShcbiAgICBgc2VsZWN0IGlkLCBvcmdfaWQsIHdzX2lkLCBtaXNzaW9uX2lkLCBmdWxsX25hbWUsIGJ1c2luZXNzX25hbWUsIGVtYWlsLCBwaG9uZSwgZW50aXR5X3R5cGUsIHN0YXR1cywgdmVyaWZpZWRcbiAgICAgICBmcm9tIGNvbnRyYWN0b3Jfc3VibWlzc2lvbnNcbiAgICAgIHdoZXJlIGlkPSQxXG4gICAgICAgIGFuZCBvcmdfaWQ9JDJcbiAgICAgIGxpbWl0IDFgLFxuICAgIFtjb250cmFjdG9ySWQsIG9yZ0lkXVxuICApO1xuICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFZlcmlmaWNhdGlvblBhY2tldChjb250cmFjdG9ySWQ6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcShcbiAgICBgc2VsZWN0ICpcbiAgICAgICBmcm9tIGNvbnRyYWN0b3JfdmVyaWZpY2F0aW9uX3BhY2tldHNcbiAgICAgIHdoZXJlIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZD0kMVxuICAgICAgICBhbmQgcGVyaW9kX3N0YXJ0PSQyXG4gICAgICAgIGFuZCBwZXJpb2RfZW5kPSQzXG4gICAgICBsaW1pdCAxYCxcbiAgICBbY29udHJhY3RvcklkLCBzdGFydCwgZW5kXVxuICApO1xuICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFN1bW1hcnlCdW5kbGUoY29udHJhY3RvcklkOiBzdHJpbmcsIG9yZ0lkOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKSB7XG4gIGNvbnN0IGNvbnRyYWN0b3IgPSBhd2FpdCBnZXRDb250cmFjdG9ySGVhZGVyKGNvbnRyYWN0b3JJZCwgb3JnSWQpO1xuICBpZiAoIWNvbnRyYWN0b3IpIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3Igbm90IGZvdW5kLlwiKTtcblxuICBjb25zdCBpbmNvbWUgPSBhd2FpdCBxKFxuICAgIGBzZWxlY3QgKlxuICAgICAgIGZyb20gY29udHJhY3Rvcl9pbmNvbWVfZW50cmllc1xuICAgICAgd2hlcmUgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkPSQxXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlID49ICQyXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlIDw9ICQzXG4gICAgICBvcmRlciBieSBlbnRyeV9kYXRlIGRlc2MsIGNyZWF0ZWRfYXQgZGVzY2AsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcblxuICBjb25zdCBleHBlbnNlcyA9IGF3YWl0IHEoXG4gICAgYHNlbGVjdCAqXG4gICAgICAgZnJvbSBjb250cmFjdG9yX2V4cGVuc2VfZW50cmllc1xuICAgICAgd2hlcmUgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkPSQxXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlID49ICQyXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlIDw9ICQzXG4gICAgICBvcmRlciBieSBlbnRyeV9kYXRlIGRlc2MsIGNyZWF0ZWRfYXQgZGVzY2AsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcblxuICBjb25zdCBwYWNrZXQgPSBhd2FpdCBnZXRWZXJpZmljYXRpb25QYWNrZXQoY29udHJhY3RvcklkLCBzdGFydCwgZW5kKTtcbiAgY29uc3QgdG90YWxzID0ge1xuICAgIGdyb3NzX2luY29tZTogMCxcbiAgICBmZWVzOiAwLFxuICAgIG5ldF9pbmNvbWU6IDAsXG4gICAgZXhwZW5zZXM6IDAsXG4gICAgZGVkdWN0aWJsZV9leHBlbnNlczogMCxcbiAgICBuZXRfYWZ0ZXJfZXhwZW5zZXM6IDAsXG4gIH07XG5cbiAgZm9yIChjb25zdCByb3cgb2YgaW5jb21lLnJvd3MpIHtcbiAgICB0b3RhbHMuZ3Jvc3NfaW5jb21lICs9IE51bWJlcihyb3cuZ3Jvc3NfYW1vdW50IHx8IDApO1xuICAgIHRvdGFscy5mZWVzICs9IE51bWJlcihyb3cuZmVlX2Ftb3VudCB8fCAwKTtcbiAgICB0b3RhbHMubmV0X2luY29tZSArPSBOdW1iZXIocm93Lm5ldF9hbW91bnQgfHwgMCk7XG4gIH1cblxuICBmb3IgKGNvbnN0IHJvdyBvZiBleHBlbnNlcy5yb3dzKSB7XG4gICAgY29uc3QgYW1vdW50ID0gTnVtYmVyKHJvdy5hbW91bnQgfHwgMCk7XG4gICAgY29uc3QgZGVkdWN0aWJsZVBlcmNlbnQgPSBOdW1iZXIocm93LmRlZHVjdGlibGVfcGVyY2VudCB8fCAwKSAvIDEwMDtcbiAgICB0b3RhbHMuZXhwZW5zZXMgKz0gYW1vdW50O1xuICAgIHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzICs9IGFtb3VudCAqIGRlZHVjdGlibGVQZXJjZW50O1xuICB9XG5cbiAgdG90YWxzLmdyb3NzX2luY29tZSA9IGNsYW1wTW9uZXkodG90YWxzLmdyb3NzX2luY29tZSk7XG4gIHRvdGFscy5mZWVzID0gY2xhbXBNb25leSh0b3RhbHMuZmVlcyk7XG4gIHRvdGFscy5uZXRfaW5jb21lID0gY2xhbXBNb25leSh0b3RhbHMubmV0X2luY29tZSk7XG4gIHRvdGFscy5leHBlbnNlcyA9IGNsYW1wTW9uZXkodG90YWxzLmV4cGVuc2VzKTtcbiAgdG90YWxzLmRlZHVjdGlibGVfZXhwZW5zZXMgPSBjbGFtcE1vbmV5KHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzKTtcbiAgdG90YWxzLm5ldF9hZnRlcl9leHBlbnNlcyA9IGNsYW1wTW9uZXkodG90YWxzLm5ldF9pbmNvbWUgLSB0b3RhbHMuZXhwZW5zZXMpO1xuXG4gIGNvbnN0IGRpZ2VzdCA9IGNyeXB0b1xuICAgIC5jcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgLnVwZGF0ZShcbiAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY29udHJhY3Rvcl9pZDogY29udHJhY3RvcklkLFxuICAgICAgICBvcmdfaWQ6IG9yZ0lkLFxuICAgICAgICBzdGFydCxcbiAgICAgICAgZW5kLFxuICAgICAgICB0b3RhbHMsXG4gICAgICAgIGluY29tZV9jb3VudDogaW5jb21lLnJvd3MubGVuZ3RoLFxuICAgICAgICBleHBlbnNlX2NvdW50OiBleHBlbnNlcy5yb3dzLmxlbmd0aCxcbiAgICAgIH0pXG4gICAgKVxuICAgIC5kaWdlc3QoXCJoZXhcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250cmFjdG9yLFxuICAgIHBhY2tldCxcbiAgICBpbmNvbWU6IGluY29tZS5yb3dzLFxuICAgIGV4cGVuc2VzOiBleHBlbnNlcy5yb3dzLFxuICAgIHRvdGFscyxcbiAgICBkaWdlc3QsXG4gICAgcGVyaW9kOiB7IHN0YXJ0LCBlbmQgfSxcbiAgfTtcbn0iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgdHlwZSBTb3ZlcmVpZ25FdmVudFNldmVyaXR5ID0gXCJpbmZvXCIgfCBcIndhcm5pbmdcIiB8IFwiZXJyb3JcIiB8IFwiY3JpdGljYWxcIjtcblxudHlwZSBFbWl0U292ZXJlaWduRXZlbnRJbnB1dCA9IHtcbiAgYWN0b3I6IHN0cmluZztcbiAgYWN0b3JVc2VySWQ/OiBzdHJpbmcgfCBudWxsO1xuICBvcmdJZDogc3RyaW5nO1xuICB3c0lkPzogc3RyaW5nIHwgbnVsbDtcbiAgbWlzc2lvbklkPzogc3RyaW5nIHwgbnVsbDtcbiAgZXZlbnRUeXBlOiBzdHJpbmc7XG4gIHNvdXJjZUFwcD86IHN0cmluZyB8IG51bGw7XG4gIHNvdXJjZVJvdXRlPzogc3RyaW5nIHwgbnVsbDtcbiAgc3ViamVjdEtpbmQ/OiBzdHJpbmcgfCBudWxsO1xuICBzdWJqZWN0SWQ/OiBzdHJpbmcgfCBudWxsO1xuICBwYXJlbnRFdmVudElkPzogc3RyaW5nIHwgbnVsbDtcbiAgc2V2ZXJpdHk/OiBTb3ZlcmVpZ25FdmVudFNldmVyaXR5O1xuICBzdW1tYXJ5Pzogc3RyaW5nIHwgbnVsbDtcbiAgY29ycmVsYXRpb25JZD86IHN0cmluZyB8IG51bGw7XG4gIGlkZW1wb3RlbmN5S2V5Pzogc3RyaW5nIHwgbnVsbDtcbiAgcGF5bG9hZD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxuZnVuY3Rpb24gaW5mZXJFdmVudEZhbWlseShldmVudFR5cGU6IHN0cmluZykge1xuICBjb25zdCBub3JtYWxpemVkID0gU3RyaW5nKGV2ZW50VHlwZSB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgZG90ID0gbm9ybWFsaXplZC5pbmRleE9mKFwiLlwiKTtcbiAgcmV0dXJuIGRvdCA9PT0gLTEgPyBub3JtYWxpemVkIDogbm9ybWFsaXplZC5zbGljZSgwLCBkb3QpO1xufVxuXG5mdW5jdGlvbiBidWlsZEludGVybmFsU2lnbmF0dXJlKHNlY3JldDogc3RyaW5nLCBwYXJ0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgY29uc3QgaG1hYyA9IGNyeXB0by5jcmVhdGVIbWFjKFwic2hhMjU2XCIsIHNlY3JldCk7XG4gIGhtYWMudXBkYXRlKEpTT04uc3RyaW5naWZ5KHBhcnRzKSk7XG4gIHJldHVybiBobWFjLmRpZ2VzdChcImJhc2U2NHVybFwiKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVtaXRTb3ZlcmVpZ25FdmVudChpbnB1dDogRW1pdFNvdmVyZWlnbkV2ZW50SW5wdXQpIHtcbiAgY29uc3QgZXZlbnRUeXBlID0gU3RyaW5nKGlucHV0LmV2ZW50VHlwZSB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKCFpbnB1dC5vcmdJZCB8fCAhZXZlbnRUeXBlIHx8ICFpbnB1dC5hY3RvcikgcmV0dXJuIG51bGw7XG5cbiAgdHJ5IHtcbiAgICBpZiAoaW5wdXQuaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcShcbiAgICAgICAgYHNlbGVjdCBpZCwgb2NjdXJyZWRfYXRcbiAgICAgICAgIGZyb20gc292ZXJlaWduX2V2ZW50c1xuICAgICAgICAgd2hlcmUgb3JnX2lkPSQxXG4gICAgICAgICAgIGFuZCBldmVudF90eXBlPSQyXG4gICAgICAgICAgIGFuZCB3c19pZCBpcyBub3QgZGlzdGluY3QgZnJvbSAkM1xuICAgICAgICAgICBhbmQgaWRlbXBvdGVuY3lfa2V5PSQ0XG4gICAgICAgICBvcmRlciBieSBvY2N1cnJlZF9hdCBkZXNjXG4gICAgICAgICBsaW1pdCAxYCxcbiAgICAgICAgW2lucHV0Lm9yZ0lkLCBldmVudFR5cGUsIGlucHV0LndzSWQgfHwgbnVsbCwgaW5wdXQuaWRlbXBvdGVuY3lLZXldXG4gICAgICApO1xuICAgICAgaWYgKGV4aXN0aW5nLnJvd3MubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IGV4aXN0aW5nLnJvd3NbMF0/LmlkIHx8IG51bGwsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IGV4aXN0aW5nLnJvd3NbMF0/Lm9jY3VycmVkX2F0IHx8IG51bGwsXG4gICAgICAgICAgZHVwbGljYXRlOiB0cnVlLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBpbnB1dC5wYXlsb2FkID8/IHt9O1xuICAgIGNvbnN0IHN1bW1hcnkgPSBTdHJpbmcoaW5wdXQuc3VtbWFyeSB8fCBcIlwiKS50cmltKCkgfHwgbnVsbDtcbiAgICBjb25zdCBvY2N1cnJlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHNlY3JldCA9IFN0cmluZyhwcm9jZXNzLmVudi5SVU5ORVJfU0hBUkVEX1NFQ1JFVCB8fCBcIlwiKS50cmltKCk7XG4gICAgY29uc3QgaW50ZXJuYWxTaWduYXR1cmUgPSBzZWNyZXRcbiAgICAgID8gYnVpbGRJbnRlcm5hbFNpZ25hdHVyZShzZWNyZXQsIHtcbiAgICAgICAgICBhY3RvcjogaW5wdXQuYWN0b3IsXG4gICAgICAgICAgb3JnX2lkOiBpbnB1dC5vcmdJZCxcbiAgICAgICAgICB3c19pZDogaW5wdXQud3NJZCB8fCBudWxsLFxuICAgICAgICAgIGV2ZW50X3R5cGU6IGV2ZW50VHlwZSxcbiAgICAgICAgICBvY2N1cnJlZF9hdDogb2NjdXJyZWRBdCxcbiAgICAgICAgICBwYXlsb2FkLFxuICAgICAgICB9KVxuICAgICAgOiBudWxsO1xuXG4gICAgY29uc3QgaW5zZXJ0ZWQgPSBhd2FpdCBxKFxuICAgICAgYGluc2VydCBpbnRvIHNvdmVyZWlnbl9ldmVudHMoXG4gICAgICAgICBvY2N1cnJlZF9hdCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZXZlbnRfdHlwZSwgZXZlbnRfZmFtaWx5LFxuICAgICAgICAgc291cmNlX2FwcCwgc291cmNlX3JvdXRlLCBhY3RvciwgYWN0b3JfdXNlcl9pZCwgc3ViamVjdF9raW5kLCBzdWJqZWN0X2lkLFxuICAgICAgICAgcGFyZW50X2V2ZW50X2lkLCBzZXZlcml0eSwgY29ycmVsYXRpb25faWQsIGlkZW1wb3RlbmN5X2tleSwgaW50ZXJuYWxfc2lnbmF0dXJlLFxuICAgICAgICAgc3VtbWFyeSwgcGF5bG9hZFxuICAgICAgIClcbiAgICAgICB2YWx1ZXMoXG4gICAgICAgICAkMSwkMiwkMywkNCwkNSwkNixcbiAgICAgICAgICQ3LCQ4LCQ5LCQxMCwkMTEsJDEyLFxuICAgICAgICAgJDEzLCQxNCwkMTUsJDE2LCQxNyxcbiAgICAgICAgICQxOCwkMTk6Ompzb25iXG4gICAgICAgKVxuICAgICAgIHJldHVybmluZyBpZCwgb2NjdXJyZWRfYXRgLFxuICAgICAgW1xuICAgICAgICBvY2N1cnJlZEF0LFxuICAgICAgICBpbnB1dC5vcmdJZCxcbiAgICAgICAgaW5wdXQud3NJZCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5taXNzaW9uSWQgfHwgbnVsbCxcbiAgICAgICAgZXZlbnRUeXBlLFxuICAgICAgICBpbmZlckV2ZW50RmFtaWx5KGV2ZW50VHlwZSksXG4gICAgICAgIGlucHV0LnNvdXJjZUFwcCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5zb3VyY2VSb3V0ZSB8fCBudWxsLFxuICAgICAgICBpbnB1dC5hY3RvcixcbiAgICAgICAgaW5wdXQuYWN0b3JVc2VySWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc3ViamVjdEtpbmQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc3ViamVjdElkIHx8IG51bGwsXG4gICAgICAgIGlucHV0LnBhcmVudEV2ZW50SWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc2V2ZXJpdHkgfHwgXCJpbmZvXCIsXG4gICAgICAgIGlucHV0LmNvcnJlbGF0aW9uSWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuaWRlbXBvdGVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgaW50ZXJuYWxTaWduYXR1cmUsXG4gICAgICAgIHN1bW1hcnksXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgXVxuICAgICk7XG5cbiAgICBjb25zdCBldmVudElkID0gaW5zZXJ0ZWQucm93c1swXT8uaWQgfHwgbnVsbDtcbiAgICBpZiAoZXZlbnRJZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcShcbiAgICAgICAgICBgaW5zZXJ0IGludG8gdGltZWxpbmVfZW50cmllcyhcbiAgICAgICAgICAgICBhdCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZXZlbnRfaWQsIGVudHJ5X3R5cGUsIHNvdXJjZV9hcHAsXG4gICAgICAgICAgICAgYWN0b3IsIGFjdG9yX3VzZXJfaWQsIHN1YmplY3Rfa2luZCwgc3ViamVjdF9pZCwgdGl0bGUsIHN1bW1hcnksIGRldGFpbFxuICAgICAgICAgICApXG4gICAgICAgICAgIHZhbHVlcygkMSwkMiwkMywkNCwkNSwkNiwkNywkOCwkOSwkMTAsJDExLCQxMiwkMTMsJDE0Ojpqc29uYilgLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIG9jY3VycmVkQXQsXG4gICAgICAgICAgICBpbnB1dC5vcmdJZCxcbiAgICAgICAgICAgIGlucHV0LndzSWQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0Lm1pc3Npb25JZCB8fCBudWxsLFxuICAgICAgICAgICAgZXZlbnRJZCxcbiAgICAgICAgICAgIGV2ZW50VHlwZSxcbiAgICAgICAgICAgIGlucHV0LnNvdXJjZUFwcCB8fCBudWxsLFxuICAgICAgICAgICAgaW5wdXQuYWN0b3IsXG4gICAgICAgICAgICBpbnB1dC5hY3RvclVzZXJJZCB8fCBudWxsLFxuICAgICAgICAgICAgaW5wdXQuc3ViamVjdEtpbmQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0LnN1YmplY3RJZCB8fCBudWxsLFxuICAgICAgICAgICAgc3VtbWFyeSB8fCBldmVudFR5cGUsXG4gICAgICAgICAgICBzdW1tYXJ5LFxuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgXVxuICAgICAgICApO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRpbWVsaW5lIGZhbm91dCBtdXN0IG5vdCBicmVhayB0aGUgb3JpZ2luYXRpbmcgYWN0aW9uLlxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpZDogZXZlbnRJZCxcbiAgICAgIG9jY3VycmVkX2F0OiBpbnNlcnRlZC5yb3dzWzBdPy5vY2N1cnJlZF9hdCB8fCBvY2N1cnJlZEF0LFxuICAgICAgZHVwbGljYXRlOiBmYWxzZSxcbiAgICB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufSJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFBQSxPQUFPQSxhQUFZOzs7QUNNWixTQUFTLEtBQUssTUFBc0I7QUFDekMsUUFBTSxJQUFJLFFBQVEsSUFBSSxJQUFJO0FBQzFCLE1BQUksQ0FBQyxFQUFHLE9BQU0sSUFBSSxNQUFNLG9CQUFvQixJQUFJLEVBQUU7QUFDbEQsU0FBTztBQUNUO0FBRU8sU0FBUyxJQUFJLE1BQWMsV0FBVyxJQUFZO0FBQ3ZELFNBQU8sUUFBUSxJQUFJLElBQUksS0FBSztBQUM5Qjs7O0FDWkEsU0FBUyxrQkFBa0IsS0FBb0U7QUFDN0YsTUFBSSxnQkFBZ0IsS0FBSyxHQUFHLEdBQUc7QUFDN0IsV0FBTztBQUFBLE1BQ0wsVUFBVTtBQUFBLE1BQ1YsU0FBUyxFQUFFLGdCQUFnQixtQkFBbUI7QUFBQSxJQUNoRDtBQUFBLEVBQ0Y7QUFFQSxNQUFJLHVCQUF1QixLQUFLLEdBQUcsR0FBRztBQUNwQyxVQUFNLFNBQVMsSUFBSSxJQUFJLEdBQUc7QUFDMUIsVUFBTSxXQUFXLFdBQVcsT0FBTyxJQUFJO0FBQ3ZDLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxTQUFTO0FBQUEsUUFDUCxnQkFBZ0I7QUFBQSxRQUNoQiwwQkFBMEI7QUFBQSxNQUM1QjtBQUFB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LGVBQWU7QUFBQSxRQUNmO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFNBQVMsT0FBTyxLQUFLLENBQUMsS0FBSztBQUNqQyxVQUFNLE1BQU0sTUFBTSxPQUFPLE1BQU0sT0FBTyxPQUFPLFdBQVcsU0FBUyxNQUFNLG9DQUFvQztBQUFBLE1BQ3pHLDBCQUEwQjtBQUFBLE1BQzFCLFlBQVksT0FBTyxXQUFXLGNBQWM7QUFBQSxNQUM1QyxjQUFjO0FBQUEsTUFDZCxZQUFZO0FBQUEsTUFDWixhQUFhO0FBQUEsTUFDYjtBQUFBLE1BQ0EsbUJBQW1CO0FBQUEsSUFDckIsQ0FBQztBQUVELFVBQU0sbUJBQW1CO0FBQUEsTUFDdkIsT0FBTyxNQUFNO0FBQUEsTUFDYixPQUFPLE1BQU07QUFBQSxNQUNiLE1BQU0sT0FBTyxXQUFXLFNBQVM7QUFBQSxNQUNqQyxXQUFXLE9BQU8sV0FBVyxjQUFjO0FBQUEsTUFDM0MsV0FBVztBQUFBLE1BQ1gsV0FBVztBQUFBLE1BQ1gsYUFBYTtBQUFBLE1BQ2IsYUFBYTtBQUFBLE1BQ2IsV0FBVztBQUFBLE1BQ1gsU0FBUyxtQ0FBbUMsT0FBTyxXQUFXLGFBQWEsT0FBTyxXQUFXLFNBQVMsc0JBQXNCO0FBQUEsTUFDNUgsU0FBUztBQUFBLFFBQ1AsV0FBVyxRQUFRLE1BQU07QUFBQSxRQUN6QixjQUFjO0FBQUEsUUFDZCxZQUFZO0FBQUEsUUFDWixhQUFhO0FBQUEsUUFDYjtBQUFBLFFBQ0EsbUJBQW1CO0FBQUEsTUFDckI7QUFBQSxJQUNGLENBQUM7QUFFRCxXQUFPLGVBQWUsS0FBSyxFQUFFLElBQUksTUFBTSxRQUFRLFFBQVEsT0FBTyxPQUFPLENBQUM7QUFBQSxFQUN4RSxTQUFTLE9BQU87QUFDZCxXQUFPLHdCQUF3QixPQUFPLCtDQUErQztBQUFBLEVBQ3ZGO0FBQ0Y7IiwKICAibmFtZXMiOiBbImNyeXB0byIsICJjcnlwdG8iLCAiY2xhbXBTdHJpbmciLCAiY2xhbXBTdHJpbmciLCAiY3J5cHRvIiwgImNyeXB0byIsICJjcnlwdG8iLCAiY2xhbXBTdHJpbmciLCAiY3J5cHRvIl0KfQo=
