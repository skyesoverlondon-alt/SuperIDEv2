
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


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
function safeUrl(value) {
  const next = clampString2(value, 500);
  if (!next) return "";
  try {
    const parsed = new URL(next);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
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

// netlify/functions/contractor-income-record.ts
var contractor_income_record_default = async (request, context) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "POST") {
      return contractorJson(405, { error: "Method not allowed." });
    }
    const body = await request.json().catch(() => ({}));
    const scope = await resolveContractorAdminScope();
    const contractorSubmissionId = safeUuid(body?.contractor_submission_id);
    const kind = clampString2(body?.kind, 20).toLowerCase();
    const entryDate = safeDate(body?.entry_date);
    const notes = clampString2(body?.notes, 3e3);
    const proofUrl = safeUrl(body?.proof_url);
    const verificationStatus = clampString2(body?.verification_status, 40) || "unreviewed";
    const verificationNotes = clampString2(body?.verification_notes, 1e3);
    const createdBy = clampString2(admin.actor, 120) || "admin";
    if (!contractorSubmissionId) return contractorJson(400, { error: "Missing contractor_submission_id." });
    if (!entryDate) return contractorJson(400, { error: "Missing or invalid entry_date." });
    if (!["income", "expense"].includes(kind)) return contractorJson(400, { error: "kind must be income or expense." });
    const contractor = await getContractorHeader(contractorSubmissionId, scope.orgId);
    if (!contractor) return contractorJson(404, { error: "Contractor not found." });
    if (kind === "income") {
      const sourceName = clampString2(body?.source_name, 160);
      const sourceType = clampString2(body?.source_type, 80) || "manual";
      const referenceCode = clampString2(body?.reference_code, 120);
      const grossAmount = clampMoney(body?.gross_amount);
      const feeAmount = clampMoney(body?.fee_amount);
      const netAmount = body?.net_amount == null ? clampMoney(grossAmount - feeAmount) : clampMoney(body?.net_amount);
      const category2 = clampString2(body?.category, 80) || "general";
      if (!sourceName) return contractorJson(400, { error: "Missing source_name." });
      const inserted2 = await q(
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
          category2,
          notes || "",
          proofUrl || null,
          verificationStatus,
          verificationNotes || "",
          createdBy
        ]
      );
      const row2 = inserted2.rows[0] || null;
      await audit(admin.actor, scope.orgId, contractor.ws_id || null, "contractor.finance.income.create", {
        contractor_submission_id: contractorSubmissionId,
        mission_id: contractor.mission_id || null,
        row_id: row2?.id || null,
        gross_amount: grossAmount,
        fee_amount: feeAmount,
        net_amount: netAmount
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
          row_id: row2?.id || null,
          source_name: sourceName,
          category: category2,
          gross_amount: grossAmount,
          fee_amount: feeAmount,
          net_amount: netAmount
        }
      });
      return contractorJson(200, { ok: true, kind, row: row2, contractor });
    }
    const vendorName = clampString2(body?.vendor_name, 160);
    const category = clampString2(body?.category, 80) || "general";
    const amount = clampMoney(body?.amount);
    const deductiblePercent = clampMoney(body?.deductible_percent == null ? 100 : body?.deductible_percent);
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
        createdBy
      ]
    );
    const row = inserted.rows[0] || null;
    await audit(admin.actor, scope.orgId, contractor.ws_id || null, "contractor.finance.expense.create", {
      contractor_submission_id: contractorSubmissionId,
      mission_id: contractor.mission_id || null,
      row_id: row?.id || null,
      amount,
      deductible_percent: deductiblePercent,
      category
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
        deductible_percent: deductiblePercent
      }
    });
    return contractorJson(200, { ok: true, kind, row, contractor });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to create contractor financial record.");
  }
};
export {
  contractor_income_record_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9lbnYudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9uZW9uLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvYXVkaXQudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9jb250cmFjdG9yLWFkbWluLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1uZXR3b3JrLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1pbmNvbWUudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9zb3ZlcmVpZ24tZXZlbnRzLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL2NvbnRyYWN0b3ItaW5jb21lLXJlY29yZC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBFbnZpcm9ubWVudCB2YXJpYWJsZSBoZWxwZXJzIGZvciBOZXRsaWZ5IGZ1bmN0aW9ucy4gIFVzZSBtdXN0KClcbiAqIHdoZW4gYW4gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQ7IGl0IHRocm93cyBhbiBlcnJvclxuICogaW5zdGVhZCBvZiByZXR1cm5pbmcgdW5kZWZpbmVkLiAgVXNlIG9wdCgpIGZvciBvcHRpb25hbCB2YWx1ZXNcbiAqIHdpdGggYW4gb3B0aW9uYWwgZmFsbGJhY2suXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtdXN0KG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHYgPSBwcm9jZXNzLmVudltuYW1lXTtcbiAgaWYgKCF2KSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgZW52IHZhcjogJHtuYW1lfWApO1xuICByZXR1cm4gdjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wdChuYW1lOiBzdHJpbmcsIGZhbGxiYWNrID0gXCJcIik6IHN0cmluZyB7XG4gIHJldHVybiBwcm9jZXNzLmVudltuYW1lXSB8fCBmYWxsYmFjaztcbn0iLCAiaW1wb3J0IHsgbXVzdCB9IGZyb20gXCIuL2VudlwiO1xuXG5mdW5jdGlvbiB0b0h0dHBTcWxFbmRwb2ludCh1cmw6IHN0cmluZyk6IHsgZW5kcG9pbnQ6IHN0cmluZzsgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB9IHtcbiAgaWYgKC9eaHR0cHM/OlxcL1xcLy9pLnRlc3QodXJsKSkge1xuICAgIHJldHVybiB7XG4gICAgICBlbmRwb2ludDogdXJsLFxuICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgIH07XG4gIH1cblxuICBpZiAoL15wb3N0Z3JlcyhxbCk/OlxcL1xcLy9pLnRlc3QodXJsKSkge1xuICAgIGNvbnN0IHBhcnNlZCA9IG5ldyBVUkwodXJsKTtcbiAgICBjb25zdCBlbmRwb2ludCA9IGBodHRwczovLyR7cGFyc2VkLmhvc3R9L3NxbGA7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgXCJOZW9uLUNvbm5lY3Rpb24tU3RyaW5nXCI6IHVybCxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIk5FT05fREFUQUJBU0VfVVJMIG11c3QgYmUgYW4gaHR0cHMgU1FMIGVuZHBvaW50IG9yIHBvc3RncmVzIGNvbm5lY3Rpb24gc3RyaW5nLlwiKTtcbn1cblxuLyoqXG4gKiBFeGVjdXRlIGEgU1FMIHF1ZXJ5IGFnYWluc3QgdGhlIE5lb24gc2VydmVybGVzcyBkYXRhYmFzZSB2aWEgdGhlXG4gKiBIVFRQIGVuZHBvaW50LiAgVGhlIE5FT05fREFUQUJBU0VfVVJMIGVudmlyb25tZW50IHZhcmlhYmxlIG11c3RcbiAqIGJlIHNldCB0byBhIHZhbGlkIE5lb24gU1FMLW92ZXItSFRUUCBlbmRwb2ludC4gIFJldHVybnMgdGhlXG4gKiBwYXJzZWQgSlNPTiByZXN1bHQgd2hpY2ggaW5jbHVkZXMgYSAncm93cycgYXJyYXkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBxKHNxbDogc3RyaW5nLCBwYXJhbXM6IGFueVtdID0gW10pIHtcbiAgY29uc3QgdXJsID0gbXVzdChcIk5FT05fREFUQUJBU0VfVVJMXCIpO1xuICBjb25zdCB0YXJnZXQgPSB0b0h0dHBTcWxFbmRwb2ludCh1cmwpO1xuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0YXJnZXQuZW5kcG9pbnQsIHtcbiAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgIGhlYWRlcnM6IHRhcmdldC5oZWFkZXJzLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IHNxbCwgcGFyYW1zIH0pLFxuICB9KTtcbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYERCIGVycm9yOiAke3RleHR9YCk7XG4gIH1cbiAgcmV0dXJuIHJlcy5qc29uKCkgYXMgUHJvbWlzZTx7IHJvd3M6IGFueVtdIH0+O1xufSIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG4vKipcbiAqIFJlY29yZCBhbiBhdWRpdCBldmVudCBpbiB0aGUgZGF0YWJhc2UuICBBbGwgY29uc2VxdWVudGlhbFxuICogb3BlcmF0aW9ucyBzaG91bGQgZW1pdCBhbiBhdWRpdCBldmVudCB3aXRoIGFjdG9yLCBvcmcsIHdvcmtzcGFjZSxcbiAqIHR5cGUgYW5kIGFyYml0cmFyeSBtZXRhZGF0YS4gIEVycm9ycyBhcmUgc3dhbGxvd2VkIHNpbGVudGx5XG4gKiBiZWNhdXNlIGF1ZGl0IGxvZ2dpbmcgbXVzdCBuZXZlciBicmVhayB1c2VyIGZsb3dzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXVkaXQoXG4gIGFjdG9yOiBzdHJpbmcsXG4gIG9yZ19pZDogc3RyaW5nIHwgbnVsbCxcbiAgd3NfaWQ6IHN0cmluZyB8IG51bGwsXG4gIHR5cGU6IHN0cmluZyxcbiAgbWV0YTogYW55XG4pIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBxKFxuICAgICAgXCJpbnNlcnQgaW50byBhdWRpdF9ldmVudHMoYWN0b3IsIG9yZ19pZCwgd3NfaWQsIHR5cGUsIG1ldGEpIHZhbHVlcygkMSwkMiwkMywkNCwkNTo6anNvbmIpXCIsXG4gICAgICBbYWN0b3IsIG9yZ19pZCwgd3NfaWQsIHR5cGUsIEpTT04uc3RyaW5naWZ5KG1ldGEgPz8ge30pXVxuICAgICk7XG4gIH0gY2F0Y2ggKF8pIHtcbiAgICAvLyBpZ25vcmUgYXVkaXQgZmFpbHVyZXNcbiAgfVxufSIsICJpbXBvcnQgY3J5cHRvIGZyb20gXCJjcnlwdG9cIjtcbmltcG9ydCB7IHEgfSBmcm9tIFwiLi9uZW9uXCI7XG5pbXBvcnQgeyBjbGFtcEFycmF5LCBjbGFtcFN0cmluZywgcmVzb2x2ZUNvbnRyYWN0b3JJbnRha2VUYXJnZXQgfSBmcm9tIFwiLi9jb250cmFjdG9yLW5ldHdvcmtcIjtcblxudHlwZSBBZG1pbkNsYWltcyA9IHtcbiAgcm9sZTogXCJhZG1pblwiO1xuICBzdWI6IHN0cmluZztcbiAgbW9kZT86IFwicGFzc3dvcmRcIiB8IFwiaWRlbnRpdHlcIjtcbiAgaWF0PzogbnVtYmVyO1xuICBleHA/OiBudW1iZXI7XG59O1xuXG50eXBlIEFkbWluUHJpbmNpcGFsID0ge1xuICBhY3Rvcjogc3RyaW5nO1xuICBtb2RlOiBcInBhc3N3b3JkXCIgfCBcImlkZW50aXR5XCI7XG59O1xuXG5mdW5jdGlvbiBiYXNlNjR1cmxFbmNvZGUoaW5wdXQ6IEJ1ZmZlciB8IHN0cmluZykge1xuICByZXR1cm4gQnVmZmVyLmZyb20oaW5wdXQpXG4gICAgLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gICAgLnJlcGxhY2UoLz0vZywgXCJcIilcbiAgICAucmVwbGFjZSgvXFwrL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9cXC8vZywgXCJfXCIpO1xufVxuXG5mdW5jdGlvbiBiYXNlNjR1cmxEZWNvZGUoaW5wdXQ6IHN0cmluZykge1xuICBjb25zdCBub3JtYWxpemVkID0gU3RyaW5nKGlucHV0IHx8IFwiXCIpLnJlcGxhY2UoLy0vZywgXCIrXCIpLnJlcGxhY2UoL18vZywgXCIvXCIpO1xuICBjb25zdCBwYWRkZWQgPSBub3JtYWxpemVkICsgXCI9XCIucmVwZWF0KCg0IC0gKG5vcm1hbGl6ZWQubGVuZ3RoICUgNCB8fCA0KSkgJSA0KTtcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHBhZGRlZCwgXCJiYXNlNjRcIik7XG59XG5cbmZ1bmN0aW9uIGhtYWNTaGEyNTYoc2VjcmV0OiBzdHJpbmcsIHBheWxvYWQ6IHN0cmluZykge1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhtYWMoXCJzaGEyNTZcIiwgc2VjcmV0KS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQm9vbCh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpID09PSBcInRydWVcIjtcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGxvd2xpc3QodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIFN0cmluZyh2YWx1ZSB8fCBcIlwiKVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUh0dHBFcnJvcihzdGF0dXM6IG51bWJlciwgbWVzc2FnZTogc3RyaW5nKSB7XG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpIGFzIEVycm9yICYgeyBzdGF0dXNDb2RlPzogbnVtYmVyIH07XG4gIGVycm9yLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJldHVybiBlcnJvcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnRyYWN0b3JKc29uKHN0YXR1czogbnVtYmVyLCBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgZXh0cmFIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30pIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShib2R5KSwge1xuICAgIHN0YXR1cyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIixcbiAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLXN0b3JlXCIsXG4gICAgICAuLi5leHRyYUhlYWRlcnMsXG4gICAgfSxcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb250cmFjdG9yRXJyb3JSZXNwb25zZShlcnJvcjogdW5rbm93biwgZmFsbGJhY2tNZXNzYWdlOiBzdHJpbmcpIHtcbiAgY29uc3QgbWVzc2FnZSA9IFN0cmluZygoZXJyb3IgYXMgYW55KT8ubWVzc2FnZSB8fCBmYWxsYmFja01lc3NhZ2UpO1xuICBjb25zdCBzdGF0dXNDb2RlID0gTnVtYmVyKChlcnJvciBhcyBhbnkpPy5zdGF0dXNDb2RlIHx8IDUwMCk7XG4gIHJldHVybiBjb250cmFjdG9ySnNvbihzdGF0dXNDb2RlLCB7IGVycm9yOiBtZXNzYWdlIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplU3RhdHVzKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNDApLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGFsbG93ZWQgPSBuZXcgU2V0KFtcIm5ld1wiLCBcInJldmlld2luZ1wiLCBcImFwcHJvdmVkXCIsIFwib25faG9sZFwiLCBcInJlamVjdGVkXCJdKTtcbiAgcmV0dXJuIGFsbG93ZWQuaGFzKG5vcm1hbGl6ZWQpID8gbm9ybWFsaXplZCA6IFwicmV2aWV3aW5nXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVUYWdzKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBjbGFtcEFycmF5KHZhbHVlLCAyMCwgNDgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2lnbkNvbnRyYWN0b3JBZG1pbkp3dChcbiAgcGF5bG9hZDogUGljazxBZG1pbkNsYWltcywgXCJyb2xlXCIgfCBcInN1YlwiIHwgXCJtb2RlXCI+LFxuICBzZWNyZXQ6IHN0cmluZyxcbiAgZXhwaXJlc0luU2Vjb25kcyA9IDYwICogNjAgKiAxMlxuKSB7XG4gIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICBjb25zdCBoZWFkZXIgPSBiYXNlNjR1cmxFbmNvZGUoSlNPTi5zdHJpbmdpZnkoeyBhbGc6IFwiSFMyNTZcIiwgdHlwOiBcIkpXVFwiIH0pKTtcbiAgY29uc3QgY2xhaW1zOiBBZG1pbkNsYWltcyA9IHtcbiAgICAuLi5wYXlsb2FkLFxuICAgIGlhdDogbm93LFxuICAgIGV4cDogbm93ICsgZXhwaXJlc0luU2Vjb25kcyxcbiAgfTtcbiAgY29uc3QgYm9keSA9IGJhc2U2NHVybEVuY29kZShKU09OLnN0cmluZ2lmeShjbGFpbXMpKTtcbiAgY29uc3QgbWVzc2FnZSA9IGAke2hlYWRlcn0uJHtib2R5fWA7XG4gIGNvbnN0IHNpZ25hdHVyZSA9IGJhc2U2NHVybEVuY29kZShobWFjU2hhMjU2KHNlY3JldCwgbWVzc2FnZSkpO1xuICByZXR1cm4gYCR7bWVzc2FnZX0uJHtzaWduYXR1cmV9YDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUNvbnRyYWN0b3JBZG1pbkp3dCh0b2tlbjogc3RyaW5nLCBzZWNyZXQ6IHN0cmluZykge1xuICBjb25zdCBwYXJ0cyA9IFN0cmluZyh0b2tlbiB8fCBcIlwiKS5zcGxpdChcIi5cIik7XG4gIGlmIChwYXJ0cy5sZW5ndGggIT09IDMgfHwgIXNlY3JldCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFtoZWFkZXIsIGJvZHksIHNpZ25hdHVyZV0gPSBwYXJ0cztcbiAgY29uc3QgbWVzc2FnZSA9IGAke2hlYWRlcn0uJHtib2R5fWA7XG4gIGNvbnN0IGV4cGVjdGVkID0gYmFzZTY0dXJsRW5jb2RlKGhtYWNTaGEyNTYoc2VjcmV0LCBtZXNzYWdlKSk7XG4gIGNvbnN0IGFjdHVhbCA9IFN0cmluZyhzaWduYXR1cmUgfHwgXCJcIik7XG4gIGlmICghZXhwZWN0ZWQgfHwgZXhwZWN0ZWQubGVuZ3RoICE9PSBhY3R1YWwubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgaWYgKCFjcnlwdG8udGltaW5nU2FmZUVxdWFsKEJ1ZmZlci5mcm9tKGV4cGVjdGVkKSwgQnVmZmVyLmZyb20oYWN0dWFsKSkpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IGNsYWltcyA9IEpTT04ucGFyc2UoYmFzZTY0dXJsRGVjb2RlKGJvZHkpLnRvU3RyaW5nKFwidXRmLThcIikpIGFzIEFkbWluQ2xhaW1zO1xuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgIGlmIChjbGFpbXMuZXhwICYmIG5vdyA+IGNsYWltcy5leHApIHJldHVybiBudWxsO1xuICAgIGlmIChjbGFpbXMucm9sZSAhPT0gXCJhZG1pblwiKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gY2xhaW1zO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWlyZUNvbnRyYWN0b3JBZG1pbihyZXF1ZXN0OiBSZXF1ZXN0LCBjb250ZXh0PzogYW55KTogUHJvbWlzZTxBZG1pblByaW5jaXBhbD4ge1xuICBjb25zdCBhdXRoID0gcmVxdWVzdC5oZWFkZXJzLmdldChcImF1dGhvcml6YXRpb25cIikgfHwgcmVxdWVzdC5oZWFkZXJzLmdldChcIkF1dGhvcml6YXRpb25cIikgfHwgXCJcIjtcbiAgY29uc3QgYmVhcmVyID0gYXV0aC5zdGFydHNXaXRoKFwiQmVhcmVyIFwiKSA/IGF1dGguc2xpY2UoXCJCZWFyZXIgXCIubGVuZ3RoKS50cmltKCkgOiBcIlwiO1xuICBjb25zdCBzZWNyZXQgPSBTdHJpbmcocHJvY2Vzcy5lbnYuQURNSU5fSldUX1NFQ1JFVCB8fCBcIlwiKS50cmltKCk7XG5cbiAgaWYgKGJlYXJlciAmJiBzZWNyZXQpIHtcbiAgICBjb25zdCBjbGFpbXMgPSBhd2FpdCB2ZXJpZnlDb250cmFjdG9yQWRtaW5Kd3QoYmVhcmVyLCBzZWNyZXQpO1xuICAgIGlmIChjbGFpbXM/LnJvbGUgPT09IFwiYWRtaW5cIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0b3I6IGNsYWltcy5zdWIgfHwgXCJjb250cmFjdG9yLWFkbWluXCIsXG4gICAgICAgIG1vZGU6IGNsYWltcy5tb2RlID09PSBcImlkZW50aXR5XCIgPyBcImlkZW50aXR5XCIgOiBcInBhc3N3b3JkXCIsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGlkZW50aXR5VXNlciA9IGNvbnRleHQ/LmNsaWVudENvbnRleHQ/LnVzZXI7XG4gIGlmIChpZGVudGl0eVVzZXIpIHtcbiAgICBjb25zdCBhbGxvd0FueW9uZSA9IHBhcnNlQm9vbChwcm9jZXNzLmVudi5BRE1JTl9JREVOVElUWV9BTllPTkUpO1xuICAgIGNvbnN0IGFsbG93bGlzdCA9IHBhcnNlQWxsb3dsaXN0KHByb2Nlc3MuZW52LkFETUlOX0VNQUlMX0FMTE9XTElTVCk7XG4gICAgY29uc3QgZW1haWwgPSBjbGFtcFN0cmluZyhpZGVudGl0eVVzZXIuZW1haWwsIDI1NCkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoYWxsb3dBbnlvbmUgfHwgKGVtYWlsICYmIGFsbG93bGlzdC5pbmNsdWRlcyhlbWFpbCkpKSB7XG4gICAgICByZXR1cm4geyBhY3RvcjogZW1haWwgfHwgXCJpZGVudGl0eS11c2VyXCIsIG1vZGU6IFwiaWRlbnRpdHlcIiB9O1xuICAgIH1cbiAgICB0aHJvdyBjcmVhdGVIdHRwRXJyb3IoNDAzLCBcIklkZW50aXR5IHVzZXIgbm90IGFsbG93bGlzdGVkLlwiKTtcbiAgfVxuXG4gIHRocm93IGNyZWF0ZUh0dHBFcnJvcig0MDEsIFwiTWlzc2luZyBvciBpbnZhbGlkIGFkbWluIGF1dGhvcml6YXRpb24uXCIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZENvbnRyYWN0b3JRdWVyeUxpbWl0KHJhdzogc3RyaW5nIHwgbnVsbCwgZmFsbGJhY2sgPSAxMDAsIG1heCA9IDIwMCkge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIocmF3IHx8IGZhbGxiYWNrKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIGZhbGxiYWNrO1xuICByZXR1cm4gTWF0aC5tYXgoMSwgTWF0aC5taW4obWF4LCBNYXRoLnRydW5jKHBhcnNlZCkpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUNvbnRyYWN0b3JMYW5lcyhyYXc6IHVua25vd24pIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhdy5tYXAoKGl0ZW0pID0+IFN0cmluZyhpdGVtIHx8IFwiXCIpLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJzZWQpID8gcGFyc2VkLm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0gfHwgXCJcIikudHJpbSgpKS5maWx0ZXIoQm9vbGVhbikgOiBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplQ29udHJhY3RvclRhZ3MocmF3OiB1bmtub3duKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiByYXcubWFwKChpdGVtKSA9PiBTdHJpbmcoaXRlbSB8fCBcIlwiKS50cmltKCkpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHR5cGVvZiByYXcgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gcmF3XG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIH1cbiAgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlKCkge1xuICByZXR1cm4gcmVzb2x2ZUNvbnRyYWN0b3JJbnRha2VUYXJnZXQoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbnRyYWN0b3JIZWFsdGhQcm9iZSgpIHtcbiAgYXdhaXQgcShcInNlbGVjdCAxIGFzIG9uZVwiLCBbXSk7XG59XG4iLCAiaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcbmltcG9ydCB7IG9wdCB9IGZyb20gXCIuL2VudlwiO1xuXG5leHBvcnQgdHlwZSBDb250cmFjdG9ySW50YWtlVGFyZ2V0ID0ge1xuICBvcmdJZDogc3RyaW5nO1xuICB3c0lkOiBzdHJpbmcgfCBudWxsO1xuICBtaXNzaW9uSWQ6IHN0cmluZyB8IG51bGw7XG59O1xuXG5jb25zdCBVVUlEX1JFID0gL15bMC05YS1mXXs4fS1bMC05YS1mXXs0fS1bMS01XVswLTlhLWZdezN9LVs4OWFiXVswLTlhLWZdezN9LVswLTlhLWZdezEyfSQvaTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wU3RyaW5nKHZhbHVlOiB1bmtub3duLCBtYXhMZW5ndGg6IG51bWJlcikge1xuICBjb25zdCBuZXh0ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQubGVuZ3RoID4gbWF4TGVuZ3RoID8gbmV4dC5zbGljZSgwLCBtYXhMZW5ndGgpIDogbmV4dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wQXJyYXkoaW5wdXQ6IHVua25vd24sIGxpbWl0OiBudW1iZXIsIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShpbnB1dCkpIHJldHVybiBbXSBhcyBzdHJpbmdbXTtcbiAgcmV0dXJuIGlucHV0XG4gICAgLm1hcCgoaXRlbSkgPT4gY2xhbXBTdHJpbmcoaXRlbSwgbWF4TGVuZ3RoKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLnNsaWNlKDAsIGxpbWl0KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVFbWFpbCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDI1NCkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKCFuZXh0IHx8ICFuZXh0LmluY2x1ZGVzKFwiQFwiKSB8fCBuZXh0LmluY2x1ZGVzKFwiIFwiKSkgcmV0dXJuIFwiXCI7XG4gIHJldHVybiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZVBob25lKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBjbGFtcFN0cmluZyh2YWx1ZSwgNDApLnJlcGxhY2UoL1teXFxkK1xcLSgpIF0vZywgXCJcIikuc2xpY2UoMCwgNDApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDUwMCk7XG4gIGlmICghbmV4dCkgcmV0dXJuIFwiXCI7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChuZXh0KTtcbiAgICBpZiAocGFyc2VkLnByb3RvY29sICE9PSBcImh0dHA6XCIgJiYgcGFyc2VkLnByb3RvY29sICE9PSBcImh0dHBzOlwiKSByZXR1cm4gXCJcIjtcbiAgICByZXR1cm4gcGFyc2VkLnRvU3RyaW5nKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUpzb25MaXN0KHZhbHVlOiB1bmtub3duLCBsaW1pdDogbnVtYmVyKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGNsYW1wQXJyYXkodmFsdWUsIGxpbWl0LCA4MCk7XG4gIGNvbnN0IHJhdyA9IFN0cmluZyh2YWx1ZSB8fCBcIlwiKS50cmltKCk7XG4gIGlmICghcmF3KSByZXR1cm4gW10gYXMgc3RyaW5nW107XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xuICAgIHJldHVybiBjbGFtcEFycmF5KHBhcnNlZCwgbGltaXQsIDgwKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlRmlsZW5hbWUodmFsdWU6IHVua25vd24pIHtcbiAgY29uc3QgbmV4dCA9IGNsYW1wU3RyaW5nKHZhbHVlLCAxODApIHx8IFwiZmlsZVwiO1xuICByZXR1cm4gbmV4dC5yZXBsYWNlKC9bXmEtekEtWjAtOS5fLV0vZywgXCJfXCIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNVdWlkTGlrZSh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gVVVJRF9SRS50ZXN0KFN0cmluZyh2YWx1ZSB8fCBcIlwiKS50cmltKCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZENvcnJlbGF0aW9uSWRGcm9tSGVhZGVycyhoZWFkZXJzOiBIZWFkZXJzKSB7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXG4gICAgaGVhZGVycy5nZXQoXCJ4LWNvcnJlbGF0aW9uLWlkXCIpLFxuICAgIGhlYWRlcnMuZ2V0KFwiWC1Db3JyZWxhdGlvbi1JZFwiKSxcbiAgICBoZWFkZXJzLmdldChcInhfY29ycmVsYXRpb25faWRcIiksXG4gIF07XG4gIGNvbnN0IHZhbHVlID0gY2xhbXBTdHJpbmcoY2FuZGlkYXRlcy5maW5kKEJvb2xlYW4pLCAxMjgpO1xuICBpZiAoIXZhbHVlKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1teYS16QS1aMC05Ol9cXC0uXS9nLCBcIlwiKS5zbGljZSgwLCAxMjgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNvbnRyYWN0b3JJbnRha2VUYXJnZXQoKSB7XG4gIGNvbnN0IG9yZ0lkID0gY2xhbXBTdHJpbmcob3B0KFwiQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRFwiKSwgNjQpO1xuICBjb25zdCB3c0lkID0gY2xhbXBTdHJpbmcob3B0KFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEXCIpLCA2NCkgfHwgbnVsbDtcbiAgY29uc3QgbWlzc2lvbklkID0gY2xhbXBTdHJpbmcob3B0KFwiQ09OVFJBQ1RPUl9ORVRXT1JLX01JU1NJT05fSURcIiksIDY0KSB8fCBudWxsO1xuXG4gIGlmICghb3JnSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250cmFjdG9yIE5ldHdvcmsgaW50YWtlIGlzIG5vdCBjb25maWd1cmVkLiBNaXNzaW5nIENPTlRSQUNUT1JfTkVUV09SS19PUkdfSUQuXCIpO1xuICB9XG5cbiAgaWYgKCFpc1V1aWRMaWtlKG9yZ0lkKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19PUkdfSUQgbXVzdCBiZSBhIFVVSUQuXCIpO1xuICB9XG5cbiAgaWYgKHdzSWQpIHtcbiAgICBpZiAoIWlzVXVpZExpa2Uod3NJZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19XU19JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gICAgfVxuICAgIGNvbnN0IHdzID0gYXdhaXQgcShcInNlbGVjdCBpZCBmcm9tIHdvcmtzcGFjZXMgd2hlcmUgaWQ9JDEgYW5kIG9yZ19pZD0kMiBsaW1pdCAxXCIsIFt3c0lkLCBvcmdJZF0pO1xuICAgIGlmICghd3Mucm93cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19XU19JRCBkb2VzIG5vdCBiZWxvbmcgdG8gQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gICAgfVxuICB9XG5cbiAgaWYgKG1pc3Npb25JZCkge1xuICAgIGlmICghaXNVdWlkTGlrZShtaXNzaW9uSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gICAgfVxuICAgIGNvbnN0IG1pc3Npb24gPSBhd2FpdCBxKFxuICAgICAgXCJzZWxlY3QgaWQsIHdzX2lkIGZyb20gbWlzc2lvbnMgd2hlcmUgaWQ9JDEgYW5kIG9yZ19pZD0kMiBsaW1pdCAxXCIsXG4gICAgICBbbWlzc2lvbklkLCBvcmdJZF1cbiAgICApO1xuICAgIGlmICghbWlzc2lvbi5yb3dzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX01JU1NJT05fSUQgZG9lcyBub3QgYmVsb25nIHRvIENPTlRSQUNUT1JfTkVUV09SS19PUkdfSUQuXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgb3JnSWQsXG4gICAgICB3c0lkOiB3c0lkIHx8IG1pc3Npb24ucm93c1swXT8ud3NfaWQgfHwgbnVsbCxcbiAgICAgIG1pc3Npb25JZCxcbiAgICB9IHNhdGlzZmllcyBDb250cmFjdG9ySW50YWtlVGFyZ2V0O1xuICB9XG5cbiAgcmV0dXJuIHsgb3JnSWQsIHdzSWQsIG1pc3Npb25JZDogbnVsbCB9IHNhdGlzZmllcyBDb250cmFjdG9ySW50YWtlVGFyZ2V0O1xufVxuIiwgImltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wU3RyaW5nKHZhbHVlOiB1bmtub3duLCBtYXhMZW5ndGg6IG51bWJlcikge1xuICBjb25zdCBuZXh0ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQubGVuZ3RoID4gbWF4TGVuZ3RoID8gbmV4dC5zbGljZSgwLCBtYXhMZW5ndGgpIDogbmV4dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wTW9uZXkodmFsdWU6IHVua25vd24pIHtcbiAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlIHx8IDApO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gMDtcbiAgcmV0dXJuIE1hdGgucm91bmQocGFyc2VkICogMTAwKSAvIDEwMDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVVcmwodmFsdWU6IHVua25vd24pIHtcbiAgY29uc3QgbmV4dCA9IGNsYW1wU3RyaW5nKHZhbHVlLCA1MDApO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IG5ldyBVUkwobmV4dCk7XG4gICAgaWYgKCFbXCJodHRwOlwiLCBcImh0dHBzOlwiXS5pbmNsdWRlcyhwYXJzZWQucHJvdG9jb2wpKSByZXR1cm4gXCJcIjtcbiAgICByZXR1cm4gcGFyc2VkLnRvU3RyaW5nKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlRGF0ZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDIwKTtcbiAgaWYgKCEvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9JC8udGVzdChuZXh0KSkgcmV0dXJuIFwiXCI7XG4gIHJldHVybiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZVV1aWQodmFsdWU6IHVua25vd24pIHtcbiAgY29uc3QgbmV4dCA9IGNsYW1wU3RyaW5nKHZhbHVlLCA2NCk7XG4gIHJldHVybiAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLTVdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pLnRlc3QobmV4dCkgPyBuZXh0IDogXCJcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNzdkVzY2FwZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCByYXcgPSBTdHJpbmcodmFsdWUgPz8gXCJcIik7XG4gIGNvbnN0IGVzY2FwZWQgPSByYXcucmVwbGFjZSgvXCIvZywgJ1wiXCInKTtcbiAgcmV0dXJuIC9bXCIsXFxuXS8udGVzdChyYXcpID8gYFwiJHtlc2NhcGVkfVwiYCA6IGVzY2FwZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRDb250cmFjdG9ySGVhZGVyKGNvbnRyYWN0b3JJZDogc3RyaW5nLCBvcmdJZDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHEoXG4gICAgYHNlbGVjdCBpZCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZnVsbF9uYW1lLCBidXNpbmVzc19uYW1lLCBlbWFpbCwgcGhvbmUsIGVudGl0eV90eXBlLCBzdGF0dXMsIHZlcmlmaWVkXG4gICAgICAgZnJvbSBjb250cmFjdG9yX3N1Ym1pc3Npb25zXG4gICAgICB3aGVyZSBpZD0kMVxuICAgICAgICBhbmQgb3JnX2lkPSQyXG4gICAgICBsaW1pdCAxYCxcbiAgICBbY29udHJhY3RvcklkLCBvcmdJZF1cbiAgKTtcbiAgcmV0dXJuIHJlc3VsdC5yb3dzWzBdIHx8IG51bGw7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRWZXJpZmljYXRpb25QYWNrZXQoY29udHJhY3RvcklkOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHEoXG4gICAgYHNlbGVjdCAqXG4gICAgICAgZnJvbSBjb250cmFjdG9yX3ZlcmlmaWNhdGlvbl9wYWNrZXRzXG4gICAgICB3aGVyZSBjb250cmFjdG9yX3N1Ym1pc3Npb25faWQ9JDFcbiAgICAgICAgYW5kIHBlcmlvZF9zdGFydD0kMlxuICAgICAgICBhbmQgcGVyaW9kX2VuZD0kM1xuICAgICAgbGltaXQgMWAsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcbiAgcmV0dXJuIHJlc3VsdC5yb3dzWzBdIHx8IG51bGw7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRTdW1tYXJ5QnVuZGxlKGNvbnRyYWN0b3JJZDogc3RyaW5nLCBvcmdJZDogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZykge1xuICBjb25zdCBjb250cmFjdG9yID0gYXdhaXQgZ2V0Q29udHJhY3RvckhlYWRlcihjb250cmFjdG9ySWQsIG9yZ0lkKTtcbiAgaWYgKCFjb250cmFjdG9yKSB0aHJvdyBuZXcgRXJyb3IoXCJDb250cmFjdG9yIG5vdCBmb3VuZC5cIik7XG5cbiAgY29uc3QgaW5jb21lID0gYXdhaXQgcShcbiAgICBgc2VsZWN0ICpcbiAgICAgICBmcm9tIGNvbnRyYWN0b3JfaW5jb21lX2VudHJpZXNcbiAgICAgIHdoZXJlIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZD0kMVxuICAgICAgICBhbmQgZW50cnlfZGF0ZSA+PSAkMlxuICAgICAgICBhbmQgZW50cnlfZGF0ZSA8PSAkM1xuICAgICAgb3JkZXIgYnkgZW50cnlfZGF0ZSBkZXNjLCBjcmVhdGVkX2F0IGRlc2NgLFxuICAgIFtjb250cmFjdG9ySWQsIHN0YXJ0LCBlbmRdXG4gICk7XG5cbiAgY29uc3QgZXhwZW5zZXMgPSBhd2FpdCBxKFxuICAgIGBzZWxlY3QgKlxuICAgICAgIGZyb20gY29udHJhY3Rvcl9leHBlbnNlX2VudHJpZXNcbiAgICAgIHdoZXJlIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZD0kMVxuICAgICAgICBhbmQgZW50cnlfZGF0ZSA+PSAkMlxuICAgICAgICBhbmQgZW50cnlfZGF0ZSA8PSAkM1xuICAgICAgb3JkZXIgYnkgZW50cnlfZGF0ZSBkZXNjLCBjcmVhdGVkX2F0IGRlc2NgLFxuICAgIFtjb250cmFjdG9ySWQsIHN0YXJ0LCBlbmRdXG4gICk7XG5cbiAgY29uc3QgcGFja2V0ID0gYXdhaXQgZ2V0VmVyaWZpY2F0aW9uUGFja2V0KGNvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZCk7XG4gIGNvbnN0IHRvdGFscyA9IHtcbiAgICBncm9zc19pbmNvbWU6IDAsXG4gICAgZmVlczogMCxcbiAgICBuZXRfaW5jb21lOiAwLFxuICAgIGV4cGVuc2VzOiAwLFxuICAgIGRlZHVjdGlibGVfZXhwZW5zZXM6IDAsXG4gICAgbmV0X2FmdGVyX2V4cGVuc2VzOiAwLFxuICB9O1xuXG4gIGZvciAoY29uc3Qgcm93IG9mIGluY29tZS5yb3dzKSB7XG4gICAgdG90YWxzLmdyb3NzX2luY29tZSArPSBOdW1iZXIocm93Lmdyb3NzX2Ftb3VudCB8fCAwKTtcbiAgICB0b3RhbHMuZmVlcyArPSBOdW1iZXIocm93LmZlZV9hbW91bnQgfHwgMCk7XG4gICAgdG90YWxzLm5ldF9pbmNvbWUgKz0gTnVtYmVyKHJvdy5uZXRfYW1vdW50IHx8IDApO1xuICB9XG5cbiAgZm9yIChjb25zdCByb3cgb2YgZXhwZW5zZXMucm93cykge1xuICAgIGNvbnN0IGFtb3VudCA9IE51bWJlcihyb3cuYW1vdW50IHx8IDApO1xuICAgIGNvbnN0IGRlZHVjdGlibGVQZXJjZW50ID0gTnVtYmVyKHJvdy5kZWR1Y3RpYmxlX3BlcmNlbnQgfHwgMCkgLyAxMDA7XG4gICAgdG90YWxzLmV4cGVuc2VzICs9IGFtb3VudDtcbiAgICB0b3RhbHMuZGVkdWN0aWJsZV9leHBlbnNlcyArPSBhbW91bnQgKiBkZWR1Y3RpYmxlUGVyY2VudDtcbiAgfVxuXG4gIHRvdGFscy5ncm9zc19pbmNvbWUgPSBjbGFtcE1vbmV5KHRvdGFscy5ncm9zc19pbmNvbWUpO1xuICB0b3RhbHMuZmVlcyA9IGNsYW1wTW9uZXkodG90YWxzLmZlZXMpO1xuICB0b3RhbHMubmV0X2luY29tZSA9IGNsYW1wTW9uZXkodG90YWxzLm5ldF9pbmNvbWUpO1xuICB0b3RhbHMuZXhwZW5zZXMgPSBjbGFtcE1vbmV5KHRvdGFscy5leHBlbnNlcyk7XG4gIHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzID0gY2xhbXBNb25leSh0b3RhbHMuZGVkdWN0aWJsZV9leHBlbnNlcyk7XG4gIHRvdGFscy5uZXRfYWZ0ZXJfZXhwZW5zZXMgPSBjbGFtcE1vbmV5KHRvdGFscy5uZXRfaW5jb21lIC0gdG90YWxzLmV4cGVuc2VzKTtcblxuICBjb25zdCBkaWdlc3QgPSBjcnlwdG9cbiAgICAuY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgIC51cGRhdGUoXG4gICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGNvbnRyYWN0b3JfaWQ6IGNvbnRyYWN0b3JJZCxcbiAgICAgICAgb3JnX2lkOiBvcmdJZCxcbiAgICAgICAgc3RhcnQsXG4gICAgICAgIGVuZCxcbiAgICAgICAgdG90YWxzLFxuICAgICAgICBpbmNvbWVfY291bnQ6IGluY29tZS5yb3dzLmxlbmd0aCxcbiAgICAgICAgZXhwZW5zZV9jb3VudDogZXhwZW5zZXMucm93cy5sZW5ndGgsXG4gICAgICB9KVxuICAgIClcbiAgICAuZGlnZXN0KFwiaGV4XCIpO1xuXG4gIHJldHVybiB7XG4gICAgY29udHJhY3RvcixcbiAgICBwYWNrZXQsXG4gICAgaW5jb21lOiBpbmNvbWUucm93cyxcbiAgICBleHBlbnNlczogZXhwZW5zZXMucm93cyxcbiAgICB0b3RhbHMsXG4gICAgZGlnZXN0LFxuICAgIHBlcmlvZDogeyBzdGFydCwgZW5kIH0sXG4gIH07XG59IiwgImltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcblxuZXhwb3J0IHR5cGUgU292ZXJlaWduRXZlbnRTZXZlcml0eSA9IFwiaW5mb1wiIHwgXCJ3YXJuaW5nXCIgfCBcImVycm9yXCIgfCBcImNyaXRpY2FsXCI7XG5cbnR5cGUgRW1pdFNvdmVyZWlnbkV2ZW50SW5wdXQgPSB7XG4gIGFjdG9yOiBzdHJpbmc7XG4gIGFjdG9yVXNlcklkPzogc3RyaW5nIHwgbnVsbDtcbiAgb3JnSWQ6IHN0cmluZztcbiAgd3NJZD86IHN0cmluZyB8IG51bGw7XG4gIG1pc3Npb25JZD86IHN0cmluZyB8IG51bGw7XG4gIGV2ZW50VHlwZTogc3RyaW5nO1xuICBzb3VyY2VBcHA/OiBzdHJpbmcgfCBudWxsO1xuICBzb3VyY2VSb3V0ZT86IHN0cmluZyB8IG51bGw7XG4gIHN1YmplY3RLaW5kPzogc3RyaW5nIHwgbnVsbDtcbiAgc3ViamVjdElkPzogc3RyaW5nIHwgbnVsbDtcbiAgcGFyZW50RXZlbnRJZD86IHN0cmluZyB8IG51bGw7XG4gIHNldmVyaXR5PzogU292ZXJlaWduRXZlbnRTZXZlcml0eTtcbiAgc3VtbWFyeT86IHN0cmluZyB8IG51bGw7XG4gIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmcgfCBudWxsO1xuICBpZGVtcG90ZW5jeUtleT86IHN0cmluZyB8IG51bGw7XG4gIHBheWxvYWQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn07XG5cbmZ1bmN0aW9uIGluZmVyRXZlbnRGYW1pbHkoZXZlbnRUeXBlOiBzdHJpbmcpIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IFN0cmluZyhldmVudFR5cGUgfHwgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGRvdCA9IG5vcm1hbGl6ZWQuaW5kZXhPZihcIi5cIik7XG4gIHJldHVybiBkb3QgPT09IC0xID8gbm9ybWFsaXplZCA6IG5vcm1hbGl6ZWQuc2xpY2UoMCwgZG90KTtcbn1cblxuZnVuY3Rpb24gYnVpbGRJbnRlcm5hbFNpZ25hdHVyZShzZWNyZXQ6IHN0cmluZywgcGFydHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB7XG4gIGNvbnN0IGhtYWMgPSBjcnlwdG8uY3JlYXRlSG1hYyhcInNoYTI1NlwiLCBzZWNyZXQpO1xuICBobWFjLnVwZGF0ZShKU09OLnN0cmluZ2lmeShwYXJ0cykpO1xuICByZXR1cm4gaG1hYy5kaWdlc3QoXCJiYXNlNjR1cmxcIik7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbWl0U292ZXJlaWduRXZlbnQoaW5wdXQ6IEVtaXRTb3ZlcmVpZ25FdmVudElucHV0KSB7XG4gIGNvbnN0IGV2ZW50VHlwZSA9IFN0cmluZyhpbnB1dC5ldmVudFR5cGUgfHwgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIGlmICghaW5wdXQub3JnSWQgfHwgIWV2ZW50VHlwZSB8fCAhaW5wdXQuYWN0b3IpIHJldHVybiBudWxsO1xuXG4gIHRyeSB7XG4gICAgaWYgKGlucHV0LmlkZW1wb3RlbmN5S2V5KSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHEoXG4gICAgICAgIGBzZWxlY3QgaWQsIG9jY3VycmVkX2F0XG4gICAgICAgICBmcm9tIHNvdmVyZWlnbl9ldmVudHNcbiAgICAgICAgIHdoZXJlIG9yZ19pZD0kMVxuICAgICAgICAgICBhbmQgZXZlbnRfdHlwZT0kMlxuICAgICAgICAgICBhbmQgd3NfaWQgaXMgbm90IGRpc3RpbmN0IGZyb20gJDNcbiAgICAgICAgICAgYW5kIGlkZW1wb3RlbmN5X2tleT0kNFxuICAgICAgICAgb3JkZXIgYnkgb2NjdXJyZWRfYXQgZGVzY1xuICAgICAgICAgbGltaXQgMWAsXG4gICAgICAgIFtpbnB1dC5vcmdJZCwgZXZlbnRUeXBlLCBpbnB1dC53c0lkIHx8IG51bGwsIGlucHV0LmlkZW1wb3RlbmN5S2V5XVxuICAgICAgKTtcbiAgICAgIGlmIChleGlzdGluZy5yb3dzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGlkOiBleGlzdGluZy5yb3dzWzBdPy5pZCB8fCBudWxsLFxuICAgICAgICAgIG9jY3VycmVkX2F0OiBleGlzdGluZy5yb3dzWzBdPy5vY2N1cnJlZF9hdCB8fCBudWxsLFxuICAgICAgICAgIGR1cGxpY2F0ZTogdHJ1ZSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwYXlsb2FkID0gaW5wdXQucGF5bG9hZCA/PyB7fTtcbiAgICBjb25zdCBzdW1tYXJ5ID0gU3RyaW5nKGlucHV0LnN1bW1hcnkgfHwgXCJcIikudHJpbSgpIHx8IG51bGw7XG4gICAgY29uc3Qgb2NjdXJyZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBzZWNyZXQgPSBTdHJpbmcocHJvY2Vzcy5lbnYuUlVOTkVSX1NIQVJFRF9TRUNSRVQgfHwgXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGludGVybmFsU2lnbmF0dXJlID0gc2VjcmV0XG4gICAgICA/IGJ1aWxkSW50ZXJuYWxTaWduYXR1cmUoc2VjcmV0LCB7XG4gICAgICAgICAgYWN0b3I6IGlucHV0LmFjdG9yLFxuICAgICAgICAgIG9yZ19pZDogaW5wdXQub3JnSWQsXG4gICAgICAgICAgd3NfaWQ6IGlucHV0LndzSWQgfHwgbnVsbCxcbiAgICAgICAgICBldmVudF90eXBlOiBldmVudFR5cGUsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IG9jY3VycmVkQXQsXG4gICAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgfSlcbiAgICAgIDogbnVsbDtcblxuICAgIGNvbnN0IGluc2VydGVkID0gYXdhaXQgcShcbiAgICAgIGBpbnNlcnQgaW50byBzb3ZlcmVpZ25fZXZlbnRzKFxuICAgICAgICAgb2NjdXJyZWRfYXQsIG9yZ19pZCwgd3NfaWQsIG1pc3Npb25faWQsIGV2ZW50X3R5cGUsIGV2ZW50X2ZhbWlseSxcbiAgICAgICAgIHNvdXJjZV9hcHAsIHNvdXJjZV9yb3V0ZSwgYWN0b3IsIGFjdG9yX3VzZXJfaWQsIHN1YmplY3Rfa2luZCwgc3ViamVjdF9pZCxcbiAgICAgICAgIHBhcmVudF9ldmVudF9pZCwgc2V2ZXJpdHksIGNvcnJlbGF0aW9uX2lkLCBpZGVtcG90ZW5jeV9rZXksIGludGVybmFsX3NpZ25hdHVyZSxcbiAgICAgICAgIHN1bW1hcnksIHBheWxvYWRcbiAgICAgICApXG4gICAgICAgdmFsdWVzKFxuICAgICAgICAgJDEsJDIsJDMsJDQsJDUsJDYsXG4gICAgICAgICAkNywkOCwkOSwkMTAsJDExLCQxMixcbiAgICAgICAgICQxMywkMTQsJDE1LCQxNiwkMTcsXG4gICAgICAgICAkMTgsJDE5Ojpqc29uYlxuICAgICAgIClcbiAgICAgICByZXR1cm5pbmcgaWQsIG9jY3VycmVkX2F0YCxcbiAgICAgIFtcbiAgICAgICAgb2NjdXJyZWRBdCxcbiAgICAgICAgaW5wdXQub3JnSWQsXG4gICAgICAgIGlucHV0LndzSWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQubWlzc2lvbklkIHx8IG51bGwsXG4gICAgICAgIGV2ZW50VHlwZSxcbiAgICAgICAgaW5mZXJFdmVudEZhbWlseShldmVudFR5cGUpLFxuICAgICAgICBpbnB1dC5zb3VyY2VBcHAgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc291cmNlUm91dGUgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuYWN0b3IsXG4gICAgICAgIGlucHV0LmFjdG9yVXNlcklkIHx8IG51bGwsXG4gICAgICAgIGlucHV0LnN1YmplY3RLaW5kIHx8IG51bGwsXG4gICAgICAgIGlucHV0LnN1YmplY3RJZCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5wYXJlbnRFdmVudElkIHx8IG51bGwsXG4gICAgICAgIGlucHV0LnNldmVyaXR5IHx8IFwiaW5mb1wiLFxuICAgICAgICBpbnB1dC5jb3JyZWxhdGlvbklkIHx8IG51bGwsXG4gICAgICAgIGlucHV0LmlkZW1wb3RlbmN5S2V5IHx8IG51bGwsXG4gICAgICAgIGludGVybmFsU2lnbmF0dXJlLFxuICAgICAgICBzdW1tYXJ5LFxuICAgICAgICBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgY29uc3QgZXZlbnRJZCA9IGluc2VydGVkLnJvd3NbMF0/LmlkIHx8IG51bGw7XG4gICAgaWYgKGV2ZW50SWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHEoXG4gICAgICAgICAgYGluc2VydCBpbnRvIHRpbWVsaW5lX2VudHJpZXMoXG4gICAgICAgICAgICAgYXQsIG9yZ19pZCwgd3NfaWQsIG1pc3Npb25faWQsIGV2ZW50X2lkLCBlbnRyeV90eXBlLCBzb3VyY2VfYXBwLFxuICAgICAgICAgICAgIGFjdG9yLCBhY3Rvcl91c2VyX2lkLCBzdWJqZWN0X2tpbmQsIHN1YmplY3RfaWQsIHRpdGxlLCBzdW1tYXJ5LCBkZXRhaWxcbiAgICAgICAgICAgKVxuICAgICAgICAgICB2YWx1ZXMoJDEsJDIsJDMsJDQsJDUsJDYsJDcsJDgsJDksJDEwLCQxMSwkMTIsJDEzLCQxNDo6anNvbmIpYCxcbiAgICAgICAgICBbXG4gICAgICAgICAgICBvY2N1cnJlZEF0LFxuICAgICAgICAgICAgaW5wdXQub3JnSWQsXG4gICAgICAgICAgICBpbnB1dC53c0lkIHx8IG51bGwsXG4gICAgICAgICAgICBpbnB1dC5taXNzaW9uSWQgfHwgbnVsbCxcbiAgICAgICAgICAgIGV2ZW50SWQsXG4gICAgICAgICAgICBldmVudFR5cGUsXG4gICAgICAgICAgICBpbnB1dC5zb3VyY2VBcHAgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0LmFjdG9yLFxuICAgICAgICAgICAgaW5wdXQuYWN0b3JVc2VySWQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0LnN1YmplY3RLaW5kIHx8IG51bGwsXG4gICAgICAgICAgICBpbnB1dC5zdWJqZWN0SWQgfHwgbnVsbCxcbiAgICAgICAgICAgIHN1bW1hcnkgfHwgZXZlbnRUeXBlLFxuICAgICAgICAgICAgc3VtbWFyeSxcbiAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgICAgIF1cbiAgICAgICAgKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaW1lbGluZSBmYW5vdXQgbXVzdCBub3QgYnJlYWsgdGhlIG9yaWdpbmF0aW5nIGFjdGlvbi5cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGV2ZW50SWQsXG4gICAgICBvY2N1cnJlZF9hdDogaW5zZXJ0ZWQucm93c1swXT8ub2NjdXJyZWRfYXQgfHwgb2NjdXJyZWRBdCxcbiAgICAgIGR1cGxpY2F0ZTogZmFsc2UsXG4gICAgfTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn0iLCAiaW1wb3J0IHsgYXVkaXQgfSBmcm9tIFwiLi9fc2hhcmVkL2F1ZGl0XCI7XG5pbXBvcnQge1xuICBjb250cmFjdG9yRXJyb3JSZXNwb25zZSxcbiAgY29udHJhY3Rvckpzb24sXG4gIHJlcXVpcmVDb250cmFjdG9yQWRtaW4sXG4gIHJlc29sdmVDb250cmFjdG9yQWRtaW5TY29wZSxcbn0gZnJvbSBcIi4vX3NoYXJlZC9jb250cmFjdG9yLWFkbWluXCI7XG5pbXBvcnQge1xuICBjbGFtcE1vbmV5LFxuICBjbGFtcFN0cmluZyxcbiAgZ2V0Q29udHJhY3RvckhlYWRlcixcbiAgc2FmZURhdGUsXG4gIHNhZmVVcmwsXG4gIHNhZmVVdWlkLFxufSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItaW5jb21lXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vX3NoYXJlZC9uZW9uXCI7XG5pbXBvcnQgeyBlbWl0U292ZXJlaWduRXZlbnQgfSBmcm9tIFwiLi9fc2hhcmVkL3NvdmVyZWlnbi1ldmVudHNcIjtcblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHJlcXVlc3Q6IFJlcXVlc3QsIGNvbnRleHQ6IGFueSkgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFkbWluID0gYXdhaXQgcmVxdWlyZUNvbnRyYWN0b3JBZG1pbihyZXF1ZXN0LCBjb250ZXh0KTtcbiAgICBpZiAocmVxdWVzdC5tZXRob2QgIT09IFwiUE9TVFwiKSB7XG4gICAgICByZXR1cm4gY29udHJhY3Rvckpzb24oNDA1LCB7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZC5cIiB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVxdWVzdC5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7XG4gICAgY29uc3Qgc2NvcGUgPSBhd2FpdCByZXNvbHZlQ29udHJhY3RvckFkbWluU2NvcGUoKTtcbiAgICBjb25zdCBjb250cmFjdG9yU3VibWlzc2lvbklkID0gc2FmZVV1aWQoKGJvZHkgYXMgYW55KT8uY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkKTtcbiAgICBjb25zdCBraW5kID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8ua2luZCwgMjApLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50cnlEYXRlID0gc2FmZURhdGUoKGJvZHkgYXMgYW55KT8uZW50cnlfZGF0ZSk7XG4gICAgY29uc3Qgbm90ZXMgPSBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5ub3RlcywgMzAwMCk7XG4gICAgY29uc3QgcHJvb2ZVcmwgPSBzYWZlVXJsKChib2R5IGFzIGFueSk/LnByb29mX3VybCk7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uU3RhdHVzID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8udmVyaWZpY2F0aW9uX3N0YXR1cywgNDApIHx8IFwidW5yZXZpZXdlZFwiO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvbk5vdGVzID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8udmVyaWZpY2F0aW9uX25vdGVzLCAxMDAwKTtcbiAgICBjb25zdCBjcmVhdGVkQnkgPSBjbGFtcFN0cmluZyhhZG1pbi5hY3RvciwgMTIwKSB8fCBcImFkbWluXCI7XG5cbiAgICBpZiAoIWNvbnRyYWN0b3JTdWJtaXNzaW9uSWQpIHJldHVybiBjb250cmFjdG9ySnNvbig0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyBjb250cmFjdG9yX3N1Ym1pc3Npb25faWQuXCIgfSk7XG4gICAgaWYgKCFlbnRyeURhdGUpIHJldHVybiBjb250cmFjdG9ySnNvbig0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyBvciBpbnZhbGlkIGVudHJ5X2RhdGUuXCIgfSk7XG4gICAgaWYgKCFbXCJpbmNvbWVcIiwgXCJleHBlbnNlXCJdLmluY2x1ZGVzKGtpbmQpKSByZXR1cm4gY29udHJhY3Rvckpzb24oNDAwLCB7IGVycm9yOiBcImtpbmQgbXVzdCBiZSBpbmNvbWUgb3IgZXhwZW5zZS5cIiB9KTtcblxuICAgIGNvbnN0IGNvbnRyYWN0b3IgPSBhd2FpdCBnZXRDb250cmFjdG9ySGVhZGVyKGNvbnRyYWN0b3JTdWJtaXNzaW9uSWQsIHNjb3BlLm9yZ0lkKTtcbiAgICBpZiAoIWNvbnRyYWN0b3IpIHJldHVybiBjb250cmFjdG9ySnNvbig0MDQsIHsgZXJyb3I6IFwiQ29udHJhY3RvciBub3QgZm91bmQuXCIgfSk7XG5cbiAgICBpZiAoa2luZCA9PT0gXCJpbmNvbWVcIikge1xuICAgICAgY29uc3Qgc291cmNlTmFtZSA9IGNsYW1wU3RyaW5nKChib2R5IGFzIGFueSk/LnNvdXJjZV9uYW1lLCAxNjApO1xuICAgICAgY29uc3Qgc291cmNlVHlwZSA9IGNsYW1wU3RyaW5nKChib2R5IGFzIGFueSk/LnNvdXJjZV90eXBlLCA4MCkgfHwgXCJtYW51YWxcIjtcbiAgICAgIGNvbnN0IHJlZmVyZW5jZUNvZGUgPSBjbGFtcFN0cmluZygoYm9keSBhcyBhbnkpPy5yZWZlcmVuY2VfY29kZSwgMTIwKTtcbiAgICAgIGNvbnN0IGdyb3NzQW1vdW50ID0gY2xhbXBNb25leSgoYm9keSBhcyBhbnkpPy5ncm9zc19hbW91bnQpO1xuICAgICAgY29uc3QgZmVlQW1vdW50ID0gY2xhbXBNb25leSgoYm9keSBhcyBhbnkpPy5mZWVfYW1vdW50KTtcbiAgICAgIGNvbnN0IG5ldEFtb3VudCA9IChib2R5IGFzIGFueSk/Lm5ldF9hbW91bnQgPT0gbnVsbCA/IGNsYW1wTW9uZXkoZ3Jvc3NBbW91bnQgLSBmZWVBbW91bnQpIDogY2xhbXBNb25leSgoYm9keSBhcyBhbnkpPy5uZXRfYW1vdW50KTtcbiAgICAgIGNvbnN0IGNhdGVnb3J5ID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8uY2F0ZWdvcnksIDgwKSB8fCBcImdlbmVyYWxcIjtcbiAgICAgIGlmICghc291cmNlTmFtZSkgcmV0dXJuIGNvbnRyYWN0b3JKc29uKDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHNvdXJjZV9uYW1lLlwiIH0pO1xuXG4gICAgICBjb25zdCBpbnNlcnRlZCA9IGF3YWl0IHEoXG4gICAgICAgIGBpbnNlcnQgaW50byBjb250cmFjdG9yX2luY29tZV9lbnRyaWVzKFxuICAgICAgICAgICBjb250cmFjdG9yX3N1Ym1pc3Npb25faWQsIGVudHJ5X2RhdGUsIHNvdXJjZV9uYW1lLCBzb3VyY2VfdHlwZSxcbiAgICAgICAgICAgcmVmZXJlbmNlX2NvZGUsIGdyb3NzX2Ftb3VudCwgZmVlX2Ftb3VudCwgbmV0X2Ftb3VudCxcbiAgICAgICAgICAgY2F0ZWdvcnksIG5vdGVzLCBwcm9vZl91cmwsIHZlcmlmaWNhdGlvbl9zdGF0dXMsIHZlcmlmaWNhdGlvbl9ub3RlcywgY3JlYXRlZF9ieVxuICAgICAgICAgKVxuICAgICAgICAgdmFsdWVzKCQxLCQyLCQzLCQ0LCQ1LCQ2LCQ3LCQ4LCQ5LCQxMCwkMTEsJDEyLCQxMywkMTQpXG4gICAgICAgICByZXR1cm5pbmcgKmAsXG4gICAgICAgIFtcbiAgICAgICAgICBjb250cmFjdG9yU3VibWlzc2lvbklkLFxuICAgICAgICAgIGVudHJ5RGF0ZSxcbiAgICAgICAgICBzb3VyY2VOYW1lLFxuICAgICAgICAgIHNvdXJjZVR5cGUsXG4gICAgICAgICAgcmVmZXJlbmNlQ29kZSB8fCBudWxsLFxuICAgICAgICAgIGdyb3NzQW1vdW50LFxuICAgICAgICAgIGZlZUFtb3VudCxcbiAgICAgICAgICBuZXRBbW91bnQsXG4gICAgICAgICAgY2F0ZWdvcnksXG4gICAgICAgICAgbm90ZXMgfHwgXCJcIixcbiAgICAgICAgICBwcm9vZlVybCB8fCBudWxsLFxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0YXR1cyxcbiAgICAgICAgICB2ZXJpZmljYXRpb25Ob3RlcyB8fCBcIlwiLFxuICAgICAgICAgIGNyZWF0ZWRCeSxcbiAgICAgICAgXVxuICAgICAgKTtcblxuICAgICAgY29uc3Qgcm93ID0gaW5zZXJ0ZWQucm93c1swXSB8fCBudWxsO1xuICAgICAgYXdhaXQgYXVkaXQoYWRtaW4uYWN0b3IsIHNjb3BlLm9yZ0lkLCBjb250cmFjdG9yLndzX2lkIHx8IG51bGwsIFwiY29udHJhY3Rvci5maW5hbmNlLmluY29tZS5jcmVhdGVcIiwge1xuICAgICAgICBjb250cmFjdG9yX3N1Ym1pc3Npb25faWQ6IGNvbnRyYWN0b3JTdWJtaXNzaW9uSWQsXG4gICAgICAgIG1pc3Npb25faWQ6IGNvbnRyYWN0b3IubWlzc2lvbl9pZCB8fCBudWxsLFxuICAgICAgICByb3dfaWQ6IHJvdz8uaWQgfHwgbnVsbCxcbiAgICAgICAgZ3Jvc3NfYW1vdW50OiBncm9zc0Ftb3VudCxcbiAgICAgICAgZmVlX2Ftb3VudDogZmVlQW1vdW50LFxuICAgICAgICBuZXRfYW1vdW50OiBuZXRBbW91bnQsXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgZW1pdFNvdmVyZWlnbkV2ZW50KHtcbiAgICAgICAgYWN0b3I6IGFkbWluLmFjdG9yLFxuICAgICAgICBvcmdJZDogc2NvcGUub3JnSWQsXG4gICAgICAgIHdzSWQ6IGNvbnRyYWN0b3Iud3NfaWQgfHwgbnVsbCxcbiAgICAgICAgbWlzc2lvbklkOiBjb250cmFjdG9yLm1pc3Npb25faWQgfHwgbnVsbCxcbiAgICAgICAgZXZlbnRUeXBlOiBcImNvbnRyYWN0b3IuZmluYW5jZS5pbmNvbWUuY3JlYXRlZFwiLFxuICAgICAgICBzb3VyY2VBcHA6IFwiQ29udHJhY3RvckluY29tZVZlcmlmaWNhdGlvblwiLFxuICAgICAgICBzb3VyY2VSb3V0ZTogXCIvYXBpL2NvbnRyYWN0b3ItaW5jb21lLXJlY29yZFwiLFxuICAgICAgICBzdWJqZWN0S2luZDogXCJjb250cmFjdG9yX3N1Ym1pc3Npb25cIixcbiAgICAgICAgc3ViamVjdElkOiBjb250cmFjdG9yU3VibWlzc2lvbklkLFxuICAgICAgICBzdW1tYXJ5OiBgSW5jb21lIHJvdyBhZGRlZCBmb3IgJHtjb250cmFjdG9yLmZ1bGxfbmFtZSB8fCBjb250cmFjdG9yLmVtYWlsIHx8IGNvbnRyYWN0b3JTdWJtaXNzaW9uSWR9YCxcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIHJvd19pZDogcm93Py5pZCB8fCBudWxsLFxuICAgICAgICAgIHNvdXJjZV9uYW1lOiBzb3VyY2VOYW1lLFxuICAgICAgICAgIGNhdGVnb3J5LFxuICAgICAgICAgIGdyb3NzX2Ftb3VudDogZ3Jvc3NBbW91bnQsXG4gICAgICAgICAgZmVlX2Ftb3VudDogZmVlQW1vdW50LFxuICAgICAgICAgIG5ldF9hbW91bnQ6IG5ldEFtb3VudCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4gY29udHJhY3Rvckpzb24oMjAwLCB7IG9rOiB0cnVlLCBraW5kLCByb3csIGNvbnRyYWN0b3IgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgdmVuZG9yTmFtZSA9IGNsYW1wU3RyaW5nKChib2R5IGFzIGFueSk/LnZlbmRvcl9uYW1lLCAxNjApO1xuICAgIGNvbnN0IGNhdGVnb3J5ID0gY2xhbXBTdHJpbmcoKGJvZHkgYXMgYW55KT8uY2F0ZWdvcnksIDgwKSB8fCBcImdlbmVyYWxcIjtcbiAgICBjb25zdCBhbW91bnQgPSBjbGFtcE1vbmV5KChib2R5IGFzIGFueSk/LmFtb3VudCk7XG4gICAgY29uc3QgZGVkdWN0aWJsZVBlcmNlbnQgPSBjbGFtcE1vbmV5KChib2R5IGFzIGFueSk/LmRlZHVjdGlibGVfcGVyY2VudCA9PSBudWxsID8gMTAwIDogKGJvZHkgYXMgYW55KT8uZGVkdWN0aWJsZV9wZXJjZW50KTtcbiAgICBpZiAoIXZlbmRvck5hbWUpIHJldHVybiBjb250cmFjdG9ySnNvbig0MDAsIHsgZXJyb3I6IFwiTWlzc2luZyB2ZW5kb3JfbmFtZS5cIiB9KTtcblxuICAgIGNvbnN0IGluc2VydGVkID0gYXdhaXQgcShcbiAgICAgIGBpbnNlcnQgaW50byBjb250cmFjdG9yX2V4cGVuc2VfZW50cmllcyhcbiAgICAgICAgIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZCwgZW50cnlfZGF0ZSwgdmVuZG9yX25hbWUsIGNhdGVnb3J5LFxuICAgICAgICAgYW1vdW50LCBkZWR1Y3RpYmxlX3BlcmNlbnQsIG5vdGVzLCBwcm9vZl91cmwsIHZlcmlmaWNhdGlvbl9zdGF0dXMsIHZlcmlmaWNhdGlvbl9ub3RlcywgY3JlYXRlZF9ieVxuICAgICAgIClcbiAgICAgICB2YWx1ZXMoJDEsJDIsJDMsJDQsJDUsJDYsJDcsJDgsJDksJDEwLCQxMSlcbiAgICAgICByZXR1cm5pbmcgKmAsXG4gICAgICBbXG4gICAgICAgIGNvbnRyYWN0b3JTdWJtaXNzaW9uSWQsXG4gICAgICAgIGVudHJ5RGF0ZSxcbiAgICAgICAgdmVuZG9yTmFtZSxcbiAgICAgICAgY2F0ZWdvcnksXG4gICAgICAgIGFtb3VudCxcbiAgICAgICAgZGVkdWN0aWJsZVBlcmNlbnQsXG4gICAgICAgIG5vdGVzIHx8IFwiXCIsXG4gICAgICAgIHByb29mVXJsIHx8IG51bGwsXG4gICAgICAgIHZlcmlmaWNhdGlvblN0YXR1cyxcbiAgICAgICAgdmVyaWZpY2F0aW9uTm90ZXMgfHwgXCJcIixcbiAgICAgICAgY3JlYXRlZEJ5LFxuICAgICAgXVxuICAgICk7XG5cbiAgICBjb25zdCByb3cgPSBpbnNlcnRlZC5yb3dzWzBdIHx8IG51bGw7XG4gICAgYXdhaXQgYXVkaXQoYWRtaW4uYWN0b3IsIHNjb3BlLm9yZ0lkLCBjb250cmFjdG9yLndzX2lkIHx8IG51bGwsIFwiY29udHJhY3Rvci5maW5hbmNlLmV4cGVuc2UuY3JlYXRlXCIsIHtcbiAgICAgIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZDogY29udHJhY3RvclN1Ym1pc3Npb25JZCxcbiAgICAgIG1pc3Npb25faWQ6IGNvbnRyYWN0b3IubWlzc2lvbl9pZCB8fCBudWxsLFxuICAgICAgcm93X2lkOiByb3c/LmlkIHx8IG51bGwsXG4gICAgICBhbW91bnQsXG4gICAgICBkZWR1Y3RpYmxlX3BlcmNlbnQ6IGRlZHVjdGlibGVQZXJjZW50LFxuICAgICAgY2F0ZWdvcnksXG4gICAgfSk7XG5cbiAgICBhd2FpdCBlbWl0U292ZXJlaWduRXZlbnQoe1xuICAgICAgYWN0b3I6IGFkbWluLmFjdG9yLFxuICAgICAgb3JnSWQ6IHNjb3BlLm9yZ0lkLFxuICAgICAgd3NJZDogY29udHJhY3Rvci53c19pZCB8fCBudWxsLFxuICAgICAgbWlzc2lvbklkOiBjb250cmFjdG9yLm1pc3Npb25faWQgfHwgbnVsbCxcbiAgICAgIGV2ZW50VHlwZTogXCJjb250cmFjdG9yLmZpbmFuY2UuZXhwZW5zZS5jcmVhdGVkXCIsXG4gICAgICBzb3VyY2VBcHA6IFwiQ29udHJhY3RvckluY29tZVZlcmlmaWNhdGlvblwiLFxuICAgICAgc291cmNlUm91dGU6IFwiL2FwaS9jb250cmFjdG9yLWluY29tZS1yZWNvcmRcIixcbiAgICAgIHN1YmplY3RLaW5kOiBcImNvbnRyYWN0b3Jfc3VibWlzc2lvblwiLFxuICAgICAgc3ViamVjdElkOiBjb250cmFjdG9yU3VibWlzc2lvbklkLFxuICAgICAgc3VtbWFyeTogYEV4cGVuc2Ugcm93IGFkZGVkIGZvciAke2NvbnRyYWN0b3IuZnVsbF9uYW1lIHx8IGNvbnRyYWN0b3IuZW1haWwgfHwgY29udHJhY3RvclN1Ym1pc3Npb25JZH1gLFxuICAgICAgcGF5bG9hZDoge1xuICAgICAgICByb3dfaWQ6IHJvdz8uaWQgfHwgbnVsbCxcbiAgICAgICAgdmVuZG9yX25hbWU6IHZlbmRvck5hbWUsXG4gICAgICAgIGNhdGVnb3J5LFxuICAgICAgICBhbW91bnQsXG4gICAgICAgIGRlZHVjdGlibGVfcGVyY2VudDogZGVkdWN0aWJsZVBlcmNlbnQsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNvbnRyYWN0b3JKc29uKDIwMCwgeyBvazogdHJ1ZSwga2luZCwgcm93LCBjb250cmFjdG9yIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiBjb250cmFjdG9yRXJyb3JSZXNwb25zZShlcnJvciwgXCJGYWlsZWQgdG8gY3JlYXRlIGNvbnRyYWN0b3IgZmluYW5jaWFsIHJlY29yZC5cIik7XG4gIH1cbn07Il0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7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YUgsYUFBYSxNQUFjLGFBQWEsR0FBRztBQUM5RCxVQUFNLFdBQVdBLGFBQWEsTUFBYyxVQUFVLEVBQUUsS0FBSztBQUM3RCxVQUFNLFNBQVMsV0FBWSxNQUFjLE1BQU07QUFDL0MsVUFBTSxvQkFBb0IsV0FBWSxNQUFjLHNCQUFzQixPQUFPLE1BQU8sTUFBYyxrQkFBa0I7QUFDeEgsUUFBSSxDQUFDLFdBQVksUUFBTyxlQUFlLEtBQUssRUFBRSxPQUFPLHVCQUF1QixDQUFDO0FBRTdFLFVBQU0sV0FBVyxNQUFNO0FBQUEsTUFDckI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFNQTtBQUFBLFFBQ0U7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0EsU0FBUztBQUFBLFFBQ1QsWUFBWTtBQUFBLFFBQ1o7QUFBQSxRQUNBLHFCQUFxQjtBQUFBLFFBQ3JCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLE1BQU0sU0FBUyxLQUFLLENBQUMsS0FBSztBQUNoQyxVQUFNLE1BQU0sTUFBTSxPQUFPLE1BQU0sT0FBTyxXQUFXLFNBQVMsTUFBTSxxQ0FBcUM7QUFBQSxNQUNuRywwQkFBMEI7QUFBQSxNQUMxQixZQUFZLFdBQVcsY0FBYztBQUFBLE1BQ3JDLFFBQVEsS0FBSyxNQUFNO0FBQUEsTUFDbkI7QUFBQSxNQUNBLG9CQUFvQjtBQUFBLE1BQ3BCO0FBQUEsSUFDRixDQUFDO0FBRUQsVUFBTSxtQkFBbUI7QUFBQSxNQUN2QixPQUFPLE1BQU07QUFBQSxNQUNiLE9BQU8sTUFBTTtBQUFBLE1BQ2IsTUFBTSxXQUFXLFNBQVM7QUFBQSxNQUMxQixXQUFXLFdBQVcsY0FBYztBQUFBLE1BQ3BDLFdBQVc7QUFBQSxNQUNYLFdBQVc7QUFBQSxNQUNYLGFBQWE7QUFBQSxNQUNiLGFBQWE7QUFBQSxNQUNiLFdBQVc7QUFBQSxNQUNYLFNBQVMseUJBQXlCLFdBQVcsYUFBYSxXQUFXLFNBQVMsc0JBQXNCO0FBQUEsTUFDcEcsU0FBUztBQUFBLFFBQ1AsUUFBUSxLQUFLLE1BQU07QUFBQSxRQUNuQixhQUFhO0FBQUEsUUFDYjtBQUFBLFFBQ0E7QUFBQSxRQUNBLG9CQUFvQjtBQUFBLE1BQ3RCO0FBQUEsSUFDRixDQUFDO0FBRUQsV0FBTyxlQUFlLEtBQUssRUFBRSxJQUFJLE1BQU0sTUFBTSxLQUFLLFdBQVcsQ0FBQztBQUFBLEVBQ2hFLFNBQVMsT0FBTztBQUNkLFdBQU8sd0JBQXdCLE9BQU8sK0NBQStDO0FBQUEsRUFDdkY7QUFDRjsiLAogICJuYW1lcyI6IFsiY2xhbXBTdHJpbmciLCAiY3J5cHRvIiwgImNyeXB0byIsICJjbGFtcFN0cmluZyIsICJjYXRlZ29yeSIsICJpbnNlcnRlZCIsICJyb3ciXQp9Cg==
