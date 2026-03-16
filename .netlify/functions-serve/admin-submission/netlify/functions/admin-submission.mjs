
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/_shared/contractor-admin.ts
import crypto from "crypto";

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
function normalizeStatus(value) {
  const normalized = clampString(value, 40).toLowerCase();
  const allowed = /* @__PURE__ */ new Set(["new", "reviewing", "approved", "on_hold", "rejected"]);
  return allowed.has(normalized) ? normalized : "reviewing";
}
function normalizeTags(value) {
  return clampArray(value, 20, 48);
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

// netlify/functions/admin-submission.ts
var admin_submission_default = async (request, context) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "PATCH") {
      return contractorJson(405, { error: "Method not allowed." });
    }
    const submissionId = String(context?.params?.splat || "").trim();
    if (!submissionId) {
      return contractorJson(400, { error: "Missing submission id." });
    }
    const body = await request.json().catch(() => ({}));
    const adminNotes = String(body?.admin_notes || "").trim().slice(0, 8e3);
    const tags = normalizeTags(body?.tags);
    const status = normalizeStatus(body?.status);
    const scope = await resolveContractorAdminScope();
    const updated = await q(
      `update contractor_submissions
          set admin_notes=$3,
              tags=$4::text[],
              status=$5,
              updated_at=now(),
              last_contacted_at=case when $5 in ('approved','on_hold','rejected') then now() else last_contacted_at end
        where id=$1
          and org_id=$2
      returning id, org_id, ws_id, mission_id, full_name, email, status, tags, admin_notes`,
      [submissionId, scope.orgId, adminNotes, tags, status]
    );
    const row = updated.rows[0];
    if (!row) {
      return contractorJson(404, { error: "Submission not found." });
    }
    await audit(admin.actor, scope.orgId, row.ws_id || null, "contractor.submission.update", {
      submission_id: row.id,
      mission_id: row.mission_id || null,
      status: row.status,
      tags,
      mode: admin.mode
    });
    await emitSovereignEvent({
      actor: admin.actor,
      orgId: scope.orgId,
      wsId: row.ws_id || null,
      missionId: row.mission_id || null,
      eventType: "contractor.submission.updated",
      sourceApp: "ContractorNetwork",
      sourceRoute: "/api/admin/submission",
      subjectKind: "contractor_submission",
      subjectId: String(row.id || submissionId),
      severity: status === "rejected" ? "warning" : "info",
      summary: `Contractor submission updated: ${row.full_name || row.email || submissionId}`,
      payload: {
        status: row.status,
        tags,
        admin_notes: row.admin_notes || "",
        admin_mode: admin.mode
      }
    });
    return contractorJson(200, { ok: true, id: row.id, status: row.status, tags });
  } catch (error) {
    return contractorErrorResponse(error, "Submission update failed.");
  }
};
export {
  admin_submission_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9jb250cmFjdG9yLWFkbWluLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvZW52LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvbmVvbi50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2NvbnRyYWN0b3ItbmV0d29yay50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9fc2hhcmVkL2F1ZGl0LnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvc292ZXJlaWduLWV2ZW50cy50cyIsICJuZXRsaWZ5L2Z1bmN0aW9ucy9hZG1pbi1zdWJtaXNzaW9uLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgY3J5cHRvIGZyb20gXCJjcnlwdG9cIjtcbmltcG9ydCB7IHEgfSBmcm9tIFwiLi9uZW9uXCI7XG5pbXBvcnQgeyBjbGFtcEFycmF5LCBjbGFtcFN0cmluZywgcmVzb2x2ZUNvbnRyYWN0b3JJbnRha2VUYXJnZXQgfSBmcm9tIFwiLi9jb250cmFjdG9yLW5ldHdvcmtcIjtcblxudHlwZSBBZG1pbkNsYWltcyA9IHtcbiAgcm9sZTogXCJhZG1pblwiO1xuICBzdWI6IHN0cmluZztcbiAgbW9kZT86IFwicGFzc3dvcmRcIiB8IFwiaWRlbnRpdHlcIjtcbiAgaWF0PzogbnVtYmVyO1xuICBleHA/OiBudW1iZXI7XG59O1xuXG50eXBlIEFkbWluUHJpbmNpcGFsID0ge1xuICBhY3Rvcjogc3RyaW5nO1xuICBtb2RlOiBcInBhc3N3b3JkXCIgfCBcImlkZW50aXR5XCI7XG59O1xuXG5mdW5jdGlvbiBiYXNlNjR1cmxFbmNvZGUoaW5wdXQ6IEJ1ZmZlciB8IHN0cmluZykge1xuICByZXR1cm4gQnVmZmVyLmZyb20oaW5wdXQpXG4gICAgLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gICAgLnJlcGxhY2UoLz0vZywgXCJcIilcbiAgICAucmVwbGFjZSgvXFwrL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9cXC8vZywgXCJfXCIpO1xufVxuXG5mdW5jdGlvbiBiYXNlNjR1cmxEZWNvZGUoaW5wdXQ6IHN0cmluZykge1xuICBjb25zdCBub3JtYWxpemVkID0gU3RyaW5nKGlucHV0IHx8IFwiXCIpLnJlcGxhY2UoLy0vZywgXCIrXCIpLnJlcGxhY2UoL18vZywgXCIvXCIpO1xuICBjb25zdCBwYWRkZWQgPSBub3JtYWxpemVkICsgXCI9XCIucmVwZWF0KCg0IC0gKG5vcm1hbGl6ZWQubGVuZ3RoICUgNCB8fCA0KSkgJSA0KTtcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHBhZGRlZCwgXCJiYXNlNjRcIik7XG59XG5cbmZ1bmN0aW9uIGhtYWNTaGEyNTYoc2VjcmV0OiBzdHJpbmcsIHBheWxvYWQ6IHN0cmluZykge1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhtYWMoXCJzaGEyNTZcIiwgc2VjcmV0KS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQm9vbCh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpID09PSBcInRydWVcIjtcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGxvd2xpc3QodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIFN0cmluZyh2YWx1ZSB8fCBcIlwiKVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUh0dHBFcnJvcihzdGF0dXM6IG51bWJlciwgbWVzc2FnZTogc3RyaW5nKSB7XG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpIGFzIEVycm9yICYgeyBzdGF0dXNDb2RlPzogbnVtYmVyIH07XG4gIGVycm9yLnN0YXR1c0NvZGUgPSBzdGF0dXM7XG4gIHJldHVybiBlcnJvcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnRyYWN0b3JKc29uKHN0YXR1czogbnVtYmVyLCBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgZXh0cmFIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30pIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShib2R5KSwge1xuICAgIHN0YXR1cyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIixcbiAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLXN0b3JlXCIsXG4gICAgICAuLi5leHRyYUhlYWRlcnMsXG4gICAgfSxcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb250cmFjdG9yRXJyb3JSZXNwb25zZShlcnJvcjogdW5rbm93biwgZmFsbGJhY2tNZXNzYWdlOiBzdHJpbmcpIHtcbiAgY29uc3QgbWVzc2FnZSA9IFN0cmluZygoZXJyb3IgYXMgYW55KT8ubWVzc2FnZSB8fCBmYWxsYmFja01lc3NhZ2UpO1xuICBjb25zdCBzdGF0dXNDb2RlID0gTnVtYmVyKChlcnJvciBhcyBhbnkpPy5zdGF0dXNDb2RlIHx8IDUwMCk7XG4gIHJldHVybiBjb250cmFjdG9ySnNvbihzdGF0dXNDb2RlLCB7IGVycm9yOiBtZXNzYWdlIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplU3RhdHVzKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNDApLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGFsbG93ZWQgPSBuZXcgU2V0KFtcIm5ld1wiLCBcInJldmlld2luZ1wiLCBcImFwcHJvdmVkXCIsIFwib25faG9sZFwiLCBcInJlamVjdGVkXCJdKTtcbiAgcmV0dXJuIGFsbG93ZWQuaGFzKG5vcm1hbGl6ZWQpID8gbm9ybWFsaXplZCA6IFwicmV2aWV3aW5nXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVUYWdzKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBjbGFtcEFycmF5KHZhbHVlLCAyMCwgNDgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2lnbkNvbnRyYWN0b3JBZG1pbkp3dChcbiAgcGF5bG9hZDogUGljazxBZG1pbkNsYWltcywgXCJyb2xlXCIgfCBcInN1YlwiIHwgXCJtb2RlXCI+LFxuICBzZWNyZXQ6IHN0cmluZyxcbiAgZXhwaXJlc0luU2Vjb25kcyA9IDYwICogNjAgKiAxMlxuKSB7XG4gIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICBjb25zdCBoZWFkZXIgPSBiYXNlNjR1cmxFbmNvZGUoSlNPTi5zdHJpbmdpZnkoeyBhbGc6IFwiSFMyNTZcIiwgdHlwOiBcIkpXVFwiIH0pKTtcbiAgY29uc3QgY2xhaW1zOiBBZG1pbkNsYWltcyA9IHtcbiAgICAuLi5wYXlsb2FkLFxuICAgIGlhdDogbm93LFxuICAgIGV4cDogbm93ICsgZXhwaXJlc0luU2Vjb25kcyxcbiAgfTtcbiAgY29uc3QgYm9keSA9IGJhc2U2NHVybEVuY29kZShKU09OLnN0cmluZ2lmeShjbGFpbXMpKTtcbiAgY29uc3QgbWVzc2FnZSA9IGAke2hlYWRlcn0uJHtib2R5fWA7XG4gIGNvbnN0IHNpZ25hdHVyZSA9IGJhc2U2NHVybEVuY29kZShobWFjU2hhMjU2KHNlY3JldCwgbWVzc2FnZSkpO1xuICByZXR1cm4gYCR7bWVzc2FnZX0uJHtzaWduYXR1cmV9YDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUNvbnRyYWN0b3JBZG1pbkp3dCh0b2tlbjogc3RyaW5nLCBzZWNyZXQ6IHN0cmluZykge1xuICBjb25zdCBwYXJ0cyA9IFN0cmluZyh0b2tlbiB8fCBcIlwiKS5zcGxpdChcIi5cIik7XG4gIGlmIChwYXJ0cy5sZW5ndGggIT09IDMgfHwgIXNlY3JldCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFtoZWFkZXIsIGJvZHksIHNpZ25hdHVyZV0gPSBwYXJ0cztcbiAgY29uc3QgbWVzc2FnZSA9IGAke2hlYWRlcn0uJHtib2R5fWA7XG4gIGNvbnN0IGV4cGVjdGVkID0gYmFzZTY0dXJsRW5jb2RlKGhtYWNTaGEyNTYoc2VjcmV0LCBtZXNzYWdlKSk7XG4gIGNvbnN0IGFjdHVhbCA9IFN0cmluZyhzaWduYXR1cmUgfHwgXCJcIik7XG4gIGlmICghZXhwZWN0ZWQgfHwgZXhwZWN0ZWQubGVuZ3RoICE9PSBhY3R1YWwubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgaWYgKCFjcnlwdG8udGltaW5nU2FmZUVxdWFsKEJ1ZmZlci5mcm9tKGV4cGVjdGVkKSwgQnVmZmVyLmZyb20oYWN0dWFsKSkpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IGNsYWltcyA9IEpTT04ucGFyc2UoYmFzZTY0dXJsRGVjb2RlKGJvZHkpLnRvU3RyaW5nKFwidXRmLThcIikpIGFzIEFkbWluQ2xhaW1zO1xuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgIGlmIChjbGFpbXMuZXhwICYmIG5vdyA+IGNsYWltcy5leHApIHJldHVybiBudWxsO1xuICAgIGlmIChjbGFpbXMucm9sZSAhPT0gXCJhZG1pblwiKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gY2xhaW1zO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWlyZUNvbnRyYWN0b3JBZG1pbihyZXF1ZXN0OiBSZXF1ZXN0LCBjb250ZXh0PzogYW55KTogUHJvbWlzZTxBZG1pblByaW5jaXBhbD4ge1xuICBjb25zdCBhdXRoID0gcmVxdWVzdC5oZWFkZXJzLmdldChcImF1dGhvcml6YXRpb25cIikgfHwgcmVxdWVzdC5oZWFkZXJzLmdldChcIkF1dGhvcml6YXRpb25cIikgfHwgXCJcIjtcbiAgY29uc3QgYmVhcmVyID0gYXV0aC5zdGFydHNXaXRoKFwiQmVhcmVyIFwiKSA/IGF1dGguc2xpY2UoXCJCZWFyZXIgXCIubGVuZ3RoKS50cmltKCkgOiBcIlwiO1xuICBjb25zdCBzZWNyZXQgPSBTdHJpbmcocHJvY2Vzcy5lbnYuQURNSU5fSldUX1NFQ1JFVCB8fCBcIlwiKS50cmltKCk7XG5cbiAgaWYgKGJlYXJlciAmJiBzZWNyZXQpIHtcbiAgICBjb25zdCBjbGFpbXMgPSBhd2FpdCB2ZXJpZnlDb250cmFjdG9yQWRtaW5Kd3QoYmVhcmVyLCBzZWNyZXQpO1xuICAgIGlmIChjbGFpbXM/LnJvbGUgPT09IFwiYWRtaW5cIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0b3I6IGNsYWltcy5zdWIgfHwgXCJjb250cmFjdG9yLWFkbWluXCIsXG4gICAgICAgIG1vZGU6IGNsYWltcy5tb2RlID09PSBcImlkZW50aXR5XCIgPyBcImlkZW50aXR5XCIgOiBcInBhc3N3b3JkXCIsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGlkZW50aXR5VXNlciA9IGNvbnRleHQ/LmNsaWVudENvbnRleHQ/LnVzZXI7XG4gIGlmIChpZGVudGl0eVVzZXIpIHtcbiAgICBjb25zdCBhbGxvd0FueW9uZSA9IHBhcnNlQm9vbChwcm9jZXNzLmVudi5BRE1JTl9JREVOVElUWV9BTllPTkUpO1xuICAgIGNvbnN0IGFsbG93bGlzdCA9IHBhcnNlQWxsb3dsaXN0KHByb2Nlc3MuZW52LkFETUlOX0VNQUlMX0FMTE9XTElTVCk7XG4gICAgY29uc3QgZW1haWwgPSBjbGFtcFN0cmluZyhpZGVudGl0eVVzZXIuZW1haWwsIDI1NCkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoYWxsb3dBbnlvbmUgfHwgKGVtYWlsICYmIGFsbG93bGlzdC5pbmNsdWRlcyhlbWFpbCkpKSB7XG4gICAgICByZXR1cm4geyBhY3RvcjogZW1haWwgfHwgXCJpZGVudGl0eS11c2VyXCIsIG1vZGU6IFwiaWRlbnRpdHlcIiB9O1xuICAgIH1cbiAgICB0aHJvdyBjcmVhdGVIdHRwRXJyb3IoNDAzLCBcIklkZW50aXR5IHVzZXIgbm90IGFsbG93bGlzdGVkLlwiKTtcbiAgfVxuXG4gIHRocm93IGNyZWF0ZUh0dHBFcnJvcig0MDEsIFwiTWlzc2luZyBvciBpbnZhbGlkIGFkbWluIGF1dGhvcml6YXRpb24uXCIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZENvbnRyYWN0b3JRdWVyeUxpbWl0KHJhdzogc3RyaW5nIHwgbnVsbCwgZmFsbGJhY2sgPSAxMDAsIG1heCA9IDIwMCkge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIocmF3IHx8IGZhbGxiYWNrKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIGZhbGxiYWNrO1xuICByZXR1cm4gTWF0aC5tYXgoMSwgTWF0aC5taW4obWF4LCBNYXRoLnRydW5jKHBhcnNlZCkpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUNvbnRyYWN0b3JMYW5lcyhyYXc6IHVua25vd24pIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhdy5tYXAoKGl0ZW0pID0+IFN0cmluZyhpdGVtIHx8IFwiXCIpLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJzZWQpID8gcGFyc2VkLm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0gfHwgXCJcIikudHJpbSgpKS5maWx0ZXIoQm9vbGVhbikgOiBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplQ29udHJhY3RvclRhZ3MocmF3OiB1bmtub3duKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiByYXcubWFwKChpdGVtKSA9PiBTdHJpbmcoaXRlbSB8fCBcIlwiKS50cmltKCkpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHR5cGVvZiByYXcgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gcmF3XG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIH1cbiAgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlKCkge1xuICByZXR1cm4gcmVzb2x2ZUNvbnRyYWN0b3JJbnRha2VUYXJnZXQoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbnRyYWN0b3JIZWFsdGhQcm9iZSgpIHtcbiAgYXdhaXQgcShcInNlbGVjdCAxIGFzIG9uZVwiLCBbXSk7XG59XG4iLCAiLyoqXG4gKiBFbnZpcm9ubWVudCB2YXJpYWJsZSBoZWxwZXJzIGZvciBOZXRsaWZ5IGZ1bmN0aW9ucy4gIFVzZSBtdXN0KClcbiAqIHdoZW4gYW4gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQ7IGl0IHRocm93cyBhbiBlcnJvclxuICogaW5zdGVhZCBvZiByZXR1cm5pbmcgdW5kZWZpbmVkLiAgVXNlIG9wdCgpIGZvciBvcHRpb25hbCB2YWx1ZXNcbiAqIHdpdGggYW4gb3B0aW9uYWwgZmFsbGJhY2suXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtdXN0KG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHYgPSBwcm9jZXNzLmVudltuYW1lXTtcbiAgaWYgKCF2KSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgZW52IHZhcjogJHtuYW1lfWApO1xuICByZXR1cm4gdjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wdChuYW1lOiBzdHJpbmcsIGZhbGxiYWNrID0gXCJcIik6IHN0cmluZyB7XG4gIHJldHVybiBwcm9jZXNzLmVudltuYW1lXSB8fCBmYWxsYmFjaztcbn0iLCAiaW1wb3J0IHsgbXVzdCB9IGZyb20gXCIuL2VudlwiO1xuXG5mdW5jdGlvbiB0b0h0dHBTcWxFbmRwb2ludCh1cmw6IHN0cmluZyk6IHsgZW5kcG9pbnQ6IHN0cmluZzsgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB9IHtcbiAgaWYgKC9eaHR0cHM/OlxcL1xcLy9pLnRlc3QodXJsKSkge1xuICAgIHJldHVybiB7XG4gICAgICBlbmRwb2ludDogdXJsLFxuICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgIH07XG4gIH1cblxuICBpZiAoL15wb3N0Z3JlcyhxbCk/OlxcL1xcLy9pLnRlc3QodXJsKSkge1xuICAgIGNvbnN0IHBhcnNlZCA9IG5ldyBVUkwodXJsKTtcbiAgICBjb25zdCBlbmRwb2ludCA9IGBodHRwczovLyR7cGFyc2VkLmhvc3R9L3NxbGA7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgXCJOZW9uLUNvbm5lY3Rpb24tU3RyaW5nXCI6IHVybCxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIk5FT05fREFUQUJBU0VfVVJMIG11c3QgYmUgYW4gaHR0cHMgU1FMIGVuZHBvaW50IG9yIHBvc3RncmVzIGNvbm5lY3Rpb24gc3RyaW5nLlwiKTtcbn1cblxuLyoqXG4gKiBFeGVjdXRlIGEgU1FMIHF1ZXJ5IGFnYWluc3QgdGhlIE5lb24gc2VydmVybGVzcyBkYXRhYmFzZSB2aWEgdGhlXG4gKiBIVFRQIGVuZHBvaW50LiAgVGhlIE5FT05fREFUQUJBU0VfVVJMIGVudmlyb25tZW50IHZhcmlhYmxlIG11c3RcbiAqIGJlIHNldCB0byBhIHZhbGlkIE5lb24gU1FMLW92ZXItSFRUUCBlbmRwb2ludC4gIFJldHVybnMgdGhlXG4gKiBwYXJzZWQgSlNPTiByZXN1bHQgd2hpY2ggaW5jbHVkZXMgYSAncm93cycgYXJyYXkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBxKHNxbDogc3RyaW5nLCBwYXJhbXM6IGFueVtdID0gW10pIHtcbiAgY29uc3QgdXJsID0gbXVzdChcIk5FT05fREFUQUJBU0VfVVJMXCIpO1xuICBjb25zdCB0YXJnZXQgPSB0b0h0dHBTcWxFbmRwb2ludCh1cmwpO1xuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0YXJnZXQuZW5kcG9pbnQsIHtcbiAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgIGhlYWRlcnM6IHRhcmdldC5oZWFkZXJzLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IHNxbCwgcGFyYW1zIH0pLFxuICB9KTtcbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYERCIGVycm9yOiAke3RleHR9YCk7XG4gIH1cbiAgcmV0dXJuIHJlcy5qc29uKCkgYXMgUHJvbWlzZTx7IHJvd3M6IGFueVtdIH0+O1xufSIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuaW1wb3J0IHsgb3B0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmV4cG9ydCB0eXBlIENvbnRyYWN0b3JJbnRha2VUYXJnZXQgPSB7XG4gIG9yZ0lkOiBzdHJpbmc7XG4gIHdzSWQ6IHN0cmluZyB8IG51bGw7XG4gIG1pc3Npb25JZDogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmNvbnN0IFVVSURfUkUgPSAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLTVdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBBcnJheShpbnB1dDogdW5rbm93biwgbGltaXQ6IG51bWJlciwgbWF4TGVuZ3RoOiBudW1iZXIpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGlucHV0KSkgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xuICByZXR1cm4gaW5wdXRcbiAgICAubWFwKChpdGVtKSA9PiBjbGFtcFN0cmluZyhpdGVtLCBtYXhMZW5ndGgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAuc2xpY2UoMCwgbGltaXQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZUVtYWlsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIW5leHQgfHwgIW5leHQuaW5jbHVkZXMoXCJAXCIpIHx8IG5leHQuaW5jbHVkZXMoXCIgXCIpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlUGhvbmUodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkucmVwbGFjZSgvW15cXGQrXFwtKCkgXS9nLCBcIlwiKS5zbGljZSgwLCA0MCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNTAwKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG5leHQpO1xuICAgIGlmIChwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cDpcIiAmJiBwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cHM6XCIpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSnNvbkxpc3QodmFsdWU6IHVua25vd24sIGxpbWl0OiBudW1iZXIpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gY2xhbXBBcnJheSh2YWx1ZSwgbGltaXQsIDgwKTtcbiAgY29uc3QgcmF3ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXSBhcyBzdHJpbmdbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgcmV0dXJuIGNsYW1wQXJyYXkocGFyc2VkLCBsaW1pdCwgODApO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW10gYXMgc3RyaW5nW107XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVGaWxlbmFtZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDE4MCkgfHwgXCJmaWxlXCI7XG4gIHJldHVybiBuZXh0LnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1V1aWRMaWtlKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBVVUlEX1JFLnRlc3QoU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29ycmVsYXRpb25JZEZyb21IZWFkZXJzKGhlYWRlcnM6IEhlYWRlcnMpIHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBoZWFkZXJzLmdldChcIngtY29ycmVsYXRpb24taWRcIiksXG4gICAgaGVhZGVycy5nZXQoXCJYLUNvcnJlbGF0aW9uLUlkXCIpLFxuICAgIGhlYWRlcnMuZ2V0KFwieF9jb3JyZWxhdGlvbl9pZFwiKSxcbiAgXTtcbiAgY29uc3QgdmFsdWUgPSBjbGFtcFN0cmluZyhjYW5kaWRhdGVzLmZpbmQoQm9vbGVhbiksIDEyOCk7XG4gIGlmICghdmFsdWUpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvW15hLXpBLVowLTk6X1xcLS5dL2csIFwiXCIpLnNsaWNlKDAsIDEyOCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpIHtcbiAgY29uc3Qgb3JnSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfT1JHX0lEXCIpLCA2NCk7XG4gIGNvbnN0IHdzSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfV1NfSURcIiksIDY0KSB8fCBudWxsO1xuICBjb25zdCBtaXNzaW9uSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRFwiKSwgNjQpIHx8IG51bGw7XG5cbiAgaWYgKCFvcmdJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3IgTmV0d29yayBpbnRha2UgaXMgbm90IGNvbmZpZ3VyZWQuIE1pc3NpbmcgQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gIH1cblxuICBpZiAoIWlzVXVpZExpa2Uob3JnSWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gIH1cblxuICBpZiAod3NJZCkge1xuICAgIGlmICghaXNVdWlkTGlrZSh3c0lkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3Qgd3MgPSBhd2FpdCBxKFwic2VsZWN0IGlkIGZyb20gd29ya3NwYWNlcyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIiwgW3dzSWQsIG9yZ0lkXSk7XG4gICAgaWYgKCF3cy5yb3dzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIGRvZXMgbm90IGJlbG9uZyB0byBDT05UUkFDVE9SX05FVFdPUktfT1JHX0lELlwiKTtcbiAgICB9XG4gIH1cblxuICBpZiAobWlzc2lvbklkKSB7XG4gICAgaWYgKCFpc1V1aWRMaWtlKG1pc3Npb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19NSVNTSU9OX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3QgbWlzc2lvbiA9IGF3YWl0IHEoXG4gICAgICBcInNlbGVjdCBpZCwgd3NfaWQgZnJvbSBtaXNzaW9ucyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIixcbiAgICAgIFttaXNzaW9uSWQsIG9yZ0lkXVxuICAgICk7XG4gICAgaWYgKCFtaXNzaW9uLnJvd3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRCBkb2VzIG5vdCBiZWxvbmcgdG8gQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBvcmdJZCxcbiAgICAgIHdzSWQ6IHdzSWQgfHwgbWlzc2lvbi5yb3dzWzBdPy53c19pZCB8fCBudWxsLFxuICAgICAgbWlzc2lvbklkLFxuICAgIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG4gIH1cblxuICByZXR1cm4geyBvcmdJZCwgd3NJZCwgbWlzc2lvbklkOiBudWxsIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG59XG4iLCAiaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcblxuLyoqXG4gKiBSZWNvcmQgYW4gYXVkaXQgZXZlbnQgaW4gdGhlIGRhdGFiYXNlLiAgQWxsIGNvbnNlcXVlbnRpYWxcbiAqIG9wZXJhdGlvbnMgc2hvdWxkIGVtaXQgYW4gYXVkaXQgZXZlbnQgd2l0aCBhY3Rvciwgb3JnLCB3b3Jrc3BhY2UsXG4gKiB0eXBlIGFuZCBhcmJpdHJhcnkgbWV0YWRhdGEuICBFcnJvcnMgYXJlIHN3YWxsb3dlZCBzaWxlbnRseVxuICogYmVjYXVzZSBhdWRpdCBsb2dnaW5nIG11c3QgbmV2ZXIgYnJlYWsgdXNlciBmbG93cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGF1ZGl0KFxuICBhY3Rvcjogc3RyaW5nLFxuICBvcmdfaWQ6IHN0cmluZyB8IG51bGwsXG4gIHdzX2lkOiBzdHJpbmcgfCBudWxsLFxuICB0eXBlOiBzdHJpbmcsXG4gIG1ldGE6IGFueVxuKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgcShcbiAgICAgIFwiaW5zZXJ0IGludG8gYXVkaXRfZXZlbnRzKGFjdG9yLCBvcmdfaWQsIHdzX2lkLCB0eXBlLCBtZXRhKSB2YWx1ZXMoJDEsJDIsJDMsJDQsJDU6Ompzb25iKVwiLFxuICAgICAgW2FjdG9yLCBvcmdfaWQsIHdzX2lkLCB0eXBlLCBKU09OLnN0cmluZ2lmeShtZXRhID8/IHt9KV1cbiAgICApO1xuICB9IGNhdGNoIChfKSB7XG4gICAgLy8gaWdub3JlIGF1ZGl0IGZhaWx1cmVzXG4gIH1cbn0iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgdHlwZSBTb3ZlcmVpZ25FdmVudFNldmVyaXR5ID0gXCJpbmZvXCIgfCBcIndhcm5pbmdcIiB8IFwiZXJyb3JcIiB8IFwiY3JpdGljYWxcIjtcblxudHlwZSBFbWl0U292ZXJlaWduRXZlbnRJbnB1dCA9IHtcbiAgYWN0b3I6IHN0cmluZztcbiAgYWN0b3JVc2VySWQ/OiBzdHJpbmcgfCBudWxsO1xuICBvcmdJZDogc3RyaW5nO1xuICB3c0lkPzogc3RyaW5nIHwgbnVsbDtcbiAgbWlzc2lvbklkPzogc3RyaW5nIHwgbnVsbDtcbiAgZXZlbnRUeXBlOiBzdHJpbmc7XG4gIHNvdXJjZUFwcD86IHN0cmluZyB8IG51bGw7XG4gIHNvdXJjZVJvdXRlPzogc3RyaW5nIHwgbnVsbDtcbiAgc3ViamVjdEtpbmQ/OiBzdHJpbmcgfCBudWxsO1xuICBzdWJqZWN0SWQ/OiBzdHJpbmcgfCBudWxsO1xuICBwYXJlbnRFdmVudElkPzogc3RyaW5nIHwgbnVsbDtcbiAgc2V2ZXJpdHk/OiBTb3ZlcmVpZ25FdmVudFNldmVyaXR5O1xuICBzdW1tYXJ5Pzogc3RyaW5nIHwgbnVsbDtcbiAgY29ycmVsYXRpb25JZD86IHN0cmluZyB8IG51bGw7XG4gIGlkZW1wb3RlbmN5S2V5Pzogc3RyaW5nIHwgbnVsbDtcbiAgcGF5bG9hZD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxuZnVuY3Rpb24gaW5mZXJFdmVudEZhbWlseShldmVudFR5cGU6IHN0cmluZykge1xuICBjb25zdCBub3JtYWxpemVkID0gU3RyaW5nKGV2ZW50VHlwZSB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgZG90ID0gbm9ybWFsaXplZC5pbmRleE9mKFwiLlwiKTtcbiAgcmV0dXJuIGRvdCA9PT0gLTEgPyBub3JtYWxpemVkIDogbm9ybWFsaXplZC5zbGljZSgwLCBkb3QpO1xufVxuXG5mdW5jdGlvbiBidWlsZEludGVybmFsU2lnbmF0dXJlKHNlY3JldDogc3RyaW5nLCBwYXJ0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgY29uc3QgaG1hYyA9IGNyeXB0by5jcmVhdGVIbWFjKFwic2hhMjU2XCIsIHNlY3JldCk7XG4gIGhtYWMudXBkYXRlKEpTT04uc3RyaW5naWZ5KHBhcnRzKSk7XG4gIHJldHVybiBobWFjLmRpZ2VzdChcImJhc2U2NHVybFwiKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVtaXRTb3ZlcmVpZ25FdmVudChpbnB1dDogRW1pdFNvdmVyZWlnbkV2ZW50SW5wdXQpIHtcbiAgY29uc3QgZXZlbnRUeXBlID0gU3RyaW5nKGlucHV0LmV2ZW50VHlwZSB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKCFpbnB1dC5vcmdJZCB8fCAhZXZlbnRUeXBlIHx8ICFpbnB1dC5hY3RvcikgcmV0dXJuIG51bGw7XG5cbiAgdHJ5IHtcbiAgICBpZiAoaW5wdXQuaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcShcbiAgICAgICAgYHNlbGVjdCBpZCwgb2NjdXJyZWRfYXRcbiAgICAgICAgIGZyb20gc292ZXJlaWduX2V2ZW50c1xuICAgICAgICAgd2hlcmUgb3JnX2lkPSQxXG4gICAgICAgICAgIGFuZCBldmVudF90eXBlPSQyXG4gICAgICAgICAgIGFuZCB3c19pZCBpcyBub3QgZGlzdGluY3QgZnJvbSAkM1xuICAgICAgICAgICBhbmQgaWRlbXBvdGVuY3lfa2V5PSQ0XG4gICAgICAgICBvcmRlciBieSBvY2N1cnJlZF9hdCBkZXNjXG4gICAgICAgICBsaW1pdCAxYCxcbiAgICAgICAgW2lucHV0Lm9yZ0lkLCBldmVudFR5cGUsIGlucHV0LndzSWQgfHwgbnVsbCwgaW5wdXQuaWRlbXBvdGVuY3lLZXldXG4gICAgICApO1xuICAgICAgaWYgKGV4aXN0aW5nLnJvd3MubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IGV4aXN0aW5nLnJvd3NbMF0/LmlkIHx8IG51bGwsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IGV4aXN0aW5nLnJvd3NbMF0/Lm9jY3VycmVkX2F0IHx8IG51bGwsXG4gICAgICAgICAgZHVwbGljYXRlOiB0cnVlLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBpbnB1dC5wYXlsb2FkID8/IHt9O1xuICAgIGNvbnN0IHN1bW1hcnkgPSBTdHJpbmcoaW5wdXQuc3VtbWFyeSB8fCBcIlwiKS50cmltKCkgfHwgbnVsbDtcbiAgICBjb25zdCBvY2N1cnJlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHNlY3JldCA9IFN0cmluZyhwcm9jZXNzLmVudi5SVU5ORVJfU0hBUkVEX1NFQ1JFVCB8fCBcIlwiKS50cmltKCk7XG4gICAgY29uc3QgaW50ZXJuYWxTaWduYXR1cmUgPSBzZWNyZXRcbiAgICAgID8gYnVpbGRJbnRlcm5hbFNpZ25hdHVyZShzZWNyZXQsIHtcbiAgICAgICAgICBhY3RvcjogaW5wdXQuYWN0b3IsXG4gICAgICAgICAgb3JnX2lkOiBpbnB1dC5vcmdJZCxcbiAgICAgICAgICB3c19pZDogaW5wdXQud3NJZCB8fCBudWxsLFxuICAgICAgICAgIGV2ZW50X3R5cGU6IGV2ZW50VHlwZSxcbiAgICAgICAgICBvY2N1cnJlZF9hdDogb2NjdXJyZWRBdCxcbiAgICAgICAgICBwYXlsb2FkLFxuICAgICAgICB9KVxuICAgICAgOiBudWxsO1xuXG4gICAgY29uc3QgaW5zZXJ0ZWQgPSBhd2FpdCBxKFxuICAgICAgYGluc2VydCBpbnRvIHNvdmVyZWlnbl9ldmVudHMoXG4gICAgICAgICBvY2N1cnJlZF9hdCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZXZlbnRfdHlwZSwgZXZlbnRfZmFtaWx5LFxuICAgICAgICAgc291cmNlX2FwcCwgc291cmNlX3JvdXRlLCBhY3RvciwgYWN0b3JfdXNlcl9pZCwgc3ViamVjdF9raW5kLCBzdWJqZWN0X2lkLFxuICAgICAgICAgcGFyZW50X2V2ZW50X2lkLCBzZXZlcml0eSwgY29ycmVsYXRpb25faWQsIGlkZW1wb3RlbmN5X2tleSwgaW50ZXJuYWxfc2lnbmF0dXJlLFxuICAgICAgICAgc3VtbWFyeSwgcGF5bG9hZFxuICAgICAgIClcbiAgICAgICB2YWx1ZXMoXG4gICAgICAgICAkMSwkMiwkMywkNCwkNSwkNixcbiAgICAgICAgICQ3LCQ4LCQ5LCQxMCwkMTEsJDEyLFxuICAgICAgICAgJDEzLCQxNCwkMTUsJDE2LCQxNyxcbiAgICAgICAgICQxOCwkMTk6Ompzb25iXG4gICAgICAgKVxuICAgICAgIHJldHVybmluZyBpZCwgb2NjdXJyZWRfYXRgLFxuICAgICAgW1xuICAgICAgICBvY2N1cnJlZEF0LFxuICAgICAgICBpbnB1dC5vcmdJZCxcbiAgICAgICAgaW5wdXQud3NJZCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5taXNzaW9uSWQgfHwgbnVsbCxcbiAgICAgICAgZXZlbnRUeXBlLFxuICAgICAgICBpbmZlckV2ZW50RmFtaWx5KGV2ZW50VHlwZSksXG4gICAgICAgIGlucHV0LnNvdXJjZUFwcCB8fCBudWxsLFxuICAgICAgICBpbnB1dC5zb3VyY2VSb3V0ZSB8fCBudWxsLFxuICAgICAgICBpbnB1dC5hY3RvcixcbiAgICAgICAgaW5wdXQuYWN0b3JVc2VySWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc3ViamVjdEtpbmQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc3ViamVjdElkIHx8IG51bGwsXG4gICAgICAgIGlucHV0LnBhcmVudEV2ZW50SWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuc2V2ZXJpdHkgfHwgXCJpbmZvXCIsXG4gICAgICAgIGlucHV0LmNvcnJlbGF0aW9uSWQgfHwgbnVsbCxcbiAgICAgICAgaW5wdXQuaWRlbXBvdGVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgaW50ZXJuYWxTaWduYXR1cmUsXG4gICAgICAgIHN1bW1hcnksXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgXVxuICAgICk7XG5cbiAgICBjb25zdCBldmVudElkID0gaW5zZXJ0ZWQucm93c1swXT8uaWQgfHwgbnVsbDtcbiAgICBpZiAoZXZlbnRJZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcShcbiAgICAgICAgICBgaW5zZXJ0IGludG8gdGltZWxpbmVfZW50cmllcyhcbiAgICAgICAgICAgICBhdCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZXZlbnRfaWQsIGVudHJ5X3R5cGUsIHNvdXJjZV9hcHAsXG4gICAgICAgICAgICAgYWN0b3IsIGFjdG9yX3VzZXJfaWQsIHN1YmplY3Rfa2luZCwgc3ViamVjdF9pZCwgdGl0bGUsIHN1bW1hcnksIGRldGFpbFxuICAgICAgICAgICApXG4gICAgICAgICAgIHZhbHVlcygkMSwkMiwkMywkNCwkNSwkNiwkNywkOCwkOSwkMTAsJDExLCQxMiwkMTMsJDE0Ojpqc29uYilgLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIG9jY3VycmVkQXQsXG4gICAgICAgICAgICBpbnB1dC5vcmdJZCxcbiAgICAgICAgICAgIGlucHV0LndzSWQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0Lm1pc3Npb25JZCB8fCBudWxsLFxuICAgICAgICAgICAgZXZlbnRJZCxcbiAgICAgICAgICAgIGV2ZW50VHlwZSxcbiAgICAgICAgICAgIGlucHV0LnNvdXJjZUFwcCB8fCBudWxsLFxuICAgICAgICAgICAgaW5wdXQuYWN0b3IsXG4gICAgICAgICAgICBpbnB1dC5hY3RvclVzZXJJZCB8fCBudWxsLFxuICAgICAgICAgICAgaW5wdXQuc3ViamVjdEtpbmQgfHwgbnVsbCxcbiAgICAgICAgICAgIGlucHV0LnN1YmplY3RJZCB8fCBudWxsLFxuICAgICAgICAgICAgc3VtbWFyeSB8fCBldmVudFR5cGUsXG4gICAgICAgICAgICBzdW1tYXJ5LFxuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgXVxuICAgICAgICApO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRpbWVsaW5lIGZhbm91dCBtdXN0IG5vdCBicmVhayB0aGUgb3JpZ2luYXRpbmcgYWN0aW9uLlxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpZDogZXZlbnRJZCxcbiAgICAgIG9jY3VycmVkX2F0OiBpbnNlcnRlZC5yb3dzWzBdPy5vY2N1cnJlZF9hdCB8fCBvY2N1cnJlZEF0LFxuICAgICAgZHVwbGljYXRlOiBmYWxzZSxcbiAgICB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufSIsICJpbXBvcnQge1xuICBjb250cmFjdG9yRXJyb3JSZXNwb25zZSxcbiAgY29udHJhY3Rvckpzb24sXG4gIG5vcm1hbGl6ZVN0YXR1cyxcbiAgbm9ybWFsaXplVGFncyxcbiAgcmVxdWlyZUNvbnRyYWN0b3JBZG1pbixcbiAgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlLFxufSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItYWRtaW5cIjtcbmltcG9ydCB7IGF1ZGl0IH0gZnJvbSBcIi4vX3NoYXJlZC9hdWRpdFwiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL19zaGFyZWQvbmVvblwiO1xuaW1wb3J0IHsgZW1pdFNvdmVyZWlnbkV2ZW50IH0gZnJvbSBcIi4vX3NoYXJlZC9zb3ZlcmVpZ24tZXZlbnRzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIChyZXF1ZXN0OiBSZXF1ZXN0LCBjb250ZXh0OiBhbnkpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhZG1pbiA9IGF3YWl0IHJlcXVpcmVDb250cmFjdG9yQWRtaW4ocmVxdWVzdCwgY29udGV4dCk7XG4gICAgaWYgKHJlcXVlc3QubWV0aG9kICE9PSBcIlBBVENIXCIpIHtcbiAgICAgIHJldHVybiBjb250cmFjdG9ySnNvbig0MDUsIHsgZXJyb3I6IFwiTWV0aG9kIG5vdCBhbGxvd2VkLlwiIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHN1Ym1pc3Npb25JZCA9IFN0cmluZyhjb250ZXh0Py5wYXJhbXM/LnNwbGF0IHx8IFwiXCIpLnRyaW0oKTtcbiAgICBpZiAoIXN1Ym1pc3Npb25JZCkge1xuICAgICAgcmV0dXJuIGNvbnRyYWN0b3JKc29uKDQwMCwgeyBlcnJvcjogXCJNaXNzaW5nIHN1Ym1pc3Npb24gaWQuXCIgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlcXVlc3QuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpO1xuICAgIGNvbnN0IGFkbWluTm90ZXMgPSBTdHJpbmcoKGJvZHkgYXMgYW55KT8uYWRtaW5fbm90ZXMgfHwgXCJcIikudHJpbSgpLnNsaWNlKDAsIDgwMDApO1xuICAgIGNvbnN0IHRhZ3MgPSBub3JtYWxpemVUYWdzKChib2R5IGFzIGFueSk/LnRhZ3MpO1xuICAgIGNvbnN0IHN0YXR1cyA9IG5vcm1hbGl6ZVN0YXR1cygoYm9keSBhcyBhbnkpPy5zdGF0dXMpO1xuICAgIGNvbnN0IHNjb3BlID0gYXdhaXQgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlKCk7XG5cbiAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcShcbiAgICAgIGB1cGRhdGUgY29udHJhY3Rvcl9zdWJtaXNzaW9uc1xuICAgICAgICAgIHNldCBhZG1pbl9ub3Rlcz0kMyxcbiAgICAgICAgICAgICAgdGFncz0kNDo6dGV4dFtdLFxuICAgICAgICAgICAgICBzdGF0dXM9JDUsXG4gICAgICAgICAgICAgIHVwZGF0ZWRfYXQ9bm93KCksXG4gICAgICAgICAgICAgIGxhc3RfY29udGFjdGVkX2F0PWNhc2Ugd2hlbiAkNSBpbiAoJ2FwcHJvdmVkJywnb25faG9sZCcsJ3JlamVjdGVkJykgdGhlbiBub3coKSBlbHNlIGxhc3RfY29udGFjdGVkX2F0IGVuZFxuICAgICAgICB3aGVyZSBpZD0kMVxuICAgICAgICAgIGFuZCBvcmdfaWQ9JDJcbiAgICAgIHJldHVybmluZyBpZCwgb3JnX2lkLCB3c19pZCwgbWlzc2lvbl9pZCwgZnVsbF9uYW1lLCBlbWFpbCwgc3RhdHVzLCB0YWdzLCBhZG1pbl9ub3Rlc2AsXG4gICAgICBbc3VibWlzc2lvbklkLCBzY29wZS5vcmdJZCwgYWRtaW5Ob3RlcywgdGFncywgc3RhdHVzXVxuICAgICk7XG5cbiAgICBjb25zdCByb3cgPSB1cGRhdGVkLnJvd3NbMF07XG4gICAgaWYgKCFyb3cpIHtcbiAgICAgIHJldHVybiBjb250cmFjdG9ySnNvbig0MDQsIHsgZXJyb3I6IFwiU3VibWlzc2lvbiBub3QgZm91bmQuXCIgfSk7XG4gICAgfVxuXG4gICAgYXdhaXQgYXVkaXQoYWRtaW4uYWN0b3IsIHNjb3BlLm9yZ0lkLCByb3cud3NfaWQgfHwgbnVsbCwgXCJjb250cmFjdG9yLnN1Ym1pc3Npb24udXBkYXRlXCIsIHtcbiAgICAgIHN1Ym1pc3Npb25faWQ6IHJvdy5pZCxcbiAgICAgIG1pc3Npb25faWQ6IHJvdy5taXNzaW9uX2lkIHx8IG51bGwsXG4gICAgICBzdGF0dXM6IHJvdy5zdGF0dXMsXG4gICAgICB0YWdzLFxuICAgICAgbW9kZTogYWRtaW4ubW9kZSxcbiAgICB9KTtcblxuICAgIGF3YWl0IGVtaXRTb3ZlcmVpZ25FdmVudCh7XG4gICAgICBhY3RvcjogYWRtaW4uYWN0b3IsXG4gICAgICBvcmdJZDogc2NvcGUub3JnSWQsXG4gICAgICB3c0lkOiByb3cud3NfaWQgfHwgbnVsbCxcbiAgICAgIG1pc3Npb25JZDogcm93Lm1pc3Npb25faWQgfHwgbnVsbCxcbiAgICAgIGV2ZW50VHlwZTogXCJjb250cmFjdG9yLnN1Ym1pc3Npb24udXBkYXRlZFwiLFxuICAgICAgc291cmNlQXBwOiBcIkNvbnRyYWN0b3JOZXR3b3JrXCIsXG4gICAgICBzb3VyY2VSb3V0ZTogXCIvYXBpL2FkbWluL3N1Ym1pc3Npb25cIixcbiAgICAgIHN1YmplY3RLaW5kOiBcImNvbnRyYWN0b3Jfc3VibWlzc2lvblwiLFxuICAgICAgc3ViamVjdElkOiBTdHJpbmcocm93LmlkIHx8IHN1Ym1pc3Npb25JZCksXG4gICAgICBzZXZlcml0eTogc3RhdHVzID09PSBcInJlamVjdGVkXCIgPyBcIndhcm5pbmdcIiA6IFwiaW5mb1wiLFxuICAgICAgc3VtbWFyeTogYENvbnRyYWN0b3Igc3VibWlzc2lvbiB1cGRhdGVkOiAke3Jvdy5mdWxsX25hbWUgfHwgcm93LmVtYWlsIHx8IHN1Ym1pc3Npb25JZH1gLFxuICAgICAgcGF5bG9hZDoge1xuICAgICAgICBzdGF0dXM6IHJvdy5zdGF0dXMsXG4gICAgICAgIHRhZ3MsXG4gICAgICAgIGFkbWluX25vdGVzOiByb3cuYWRtaW5fbm90ZXMgfHwgXCJcIixcbiAgICAgICAgYWRtaW5fbW9kZTogYWRtaW4ubW9kZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29udHJhY3Rvckpzb24oMjAwLCB7IG9rOiB0cnVlLCBpZDogcm93LmlkLCBzdGF0dXM6IHJvdy5zdGF0dXMsIHRhZ3MgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIGNvbnRyYWN0b3JFcnJvclJlc3BvbnNlKGVycm9yLCBcIlN1Ym1pc3Npb24gdXBkYXRlIGZhaWxlZC5cIik7XG4gIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBQUEsT0FBTyxZQUFZOzs7QUNNWixTQUFTLEtBQUssTUFBc0I7QUFDekMsUUFBTSxJQUFJLFFBQVEsSUFBSSxJQUFJO0FBQzFCLE1BQUksQ0FBQyxFQUFHLE9BQU0sSUFBSSxNQUFNLG9CQUFvQixJQUFJLEVBQUU7QUFDbEQsU0FBTztBQUNUO0FBRU8sU0FBUyxJQUFJLE1BQWMsV0FBVyxJQUFZO0FBQ3ZELFNBQU8sUUFBUSxJQUFJLElBQUksS0FBSztBQUM5Qjs7O0FDWkEsU0FBUyxrQkFBa0IsS0FBb0U7QUFDN0YsTUFBSSxnQkFBZ0IsS0FBSyxHQUFHLEdBQUc7QUFDN0IsV0FBTztBQUFBLE1BQ0wsVUFBVTtBQUFBLE1BQ1YsU0FBUyxFQUFFLGdCQUFnQixtQkFBbUI7QUFBQSxJQUNoRDtBQUFBLEVBQ0Y7QUFFQSxNQUFJLHVCQUF1QixLQUFLLEdBQUcsR0FBRztBQUNwQyxVQUFNLFNBQVMsSUFBSSxJQUFJLEdBQUc7QUFDMUIsVUFBTSxXQUFXLFdBQVcsT0FBTyxJQUFJO0FBQ3ZDLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxTQUFTO0FBQUEsUUFDUCxnQkFBZ0I7QUFBQSxRQUNoQiwwQkFBMEI7QUFBQSxNQUM1QjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsUUFBTSxJQUFJLE1BQU0sZ0ZBQWdGO0FBQ2xHO0FBUUEsZUFBc0Is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
