
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
function csvEscape(value) {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, '""');
  return /[",\n]/.test(raw) ? `"${escaped}"` : escaped;
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

// netlify/functions/contractor-income-export.ts
var contractor_income_export_default = async (request, context) => {
  try {
    const admin = await requireContractorAdmin(request, context);
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { "Content-Type": "application/json" } });
    }
    const scope = await resolveContractorAdminScope();
    const url = new URL(request.url);
    const contractorSubmissionId = safeUuid(url.searchParams.get("contractor_submission_id"));
    const start = safeDate(url.searchParams.get("start"));
    const end = safeDate(url.searchParams.get("end"));
    if (!contractorSubmissionId) return new Response(JSON.stringify({ error: "Missing contractor_submission_id." }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (!start || !end) return new Response(JSON.stringify({ error: "Missing start or end date." }), { status: 400, headers: { "Content-Type": "application/json" } });
    const bundle = await getSummaryBundle(contractorSubmissionId, scope.orgId, start, end);
    await audit(admin.actor, scope.orgId, bundle.contractor.ws_id || null, "contractor.finance.export", {
      contractor_submission_id: contractorSubmissionId,
      mission_id: bundle.contractor.mission_id || null,
      period_start: start,
      period_end: end,
      digest: bundle.digest
    });
    const lines = [];
    lines.push(["section", "contractor_id", "contractor_name", "entry_date", "name", "type", "reference", "gross", "fees", "net", "expense_amount", "deductible_percent", "category", "verification_status", "notes", "proof_url"].join(","));
    for (const row of bundle.income || []) {
      lines.push(
        [
          "income",
          bundle.contractor.id,
          bundle.contractor.full_name,
          row.entry_date,
          row.source_name,
          row.source_type,
          row.reference_code || "",
          row.gross_amount,
          row.fee_amount,
          row.net_amount,
          "",
          "",
          row.category || "",
          row.verification_status || "",
          row.notes || "",
          row.proof_url || ""
        ].map(csvEscape).join(",")
      );
    }
    for (const row of bundle.expenses || []) {
      lines.push(
        [
          "expense",
          bundle.contractor.id,
          bundle.contractor.full_name,
          row.entry_date,
          row.vendor_name,
          "expense",
          "",
          "",
          "",
          "",
          row.amount,
          row.deductible_percent,
          row.category || "",
          row.verification_status || "",
          row.notes || "",
          row.proof_url || ""
        ].map(csvEscape).join(",")
      );
    }
    lines.push("");
    lines.push(["summary_key", "summary_value"].join(","));
    Object.entries(bundle.totals || {}).forEach(([key, value]) => lines.push([csvEscape(key), csvEscape(value)].join(",")));
    lines.push([csvEscape("period_start"), csvEscape(bundle.period.start)].join(","));
    lines.push([csvEscape("period_end"), csvEscape(bundle.period.end)].join(","));
    lines.push([csvEscape("digest"), csvEscape(bundle.digest)].join(","));
    if (bundle.packet) {
      lines.push([csvEscape("packet_status"), csvEscape(bundle.packet.status || "")].join(","));
      lines.push([csvEscape("verification_tier"), csvEscape(bundle.packet.verification_tier || "")].join(","));
      lines.push([csvEscape("packet_hash"), csvEscape(bundle.packet.packet_hash || "")].join(","));
    }
    const filename = `contractor-income-export-${bundle.contractor.id}-${start}-to-${end}.csv`;
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to export contractor financial records.");
  }
};
export {
  contractor_income_export_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9lbnYudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9uZW9uLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvYXVkaXQudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9jb250cmFjdG9yLWFkbWluLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1uZXR3b3JrLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1pbmNvbWUudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvY29udHJhY3Rvci1pbmNvbWUtZXhwb3J0LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIGhlbHBlcnMgZm9yIE5ldGxpZnkgZnVuY3Rpb25zLiAgVXNlIG11c3QoKVxuICogd2hlbiBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZDsgaXQgdGhyb3dzIGFuIGVycm9yXG4gKiBpbnN0ZWFkIG9mIHJldHVybmluZyB1bmRlZmluZWQuICBVc2Ugb3B0KCkgZm9yIG9wdGlvbmFsIHZhbHVlc1xuICogd2l0aCBhbiBvcHRpb25hbCBmYWxsYmFjay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG11c3QobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdiA9IHByb2Nlc3MuZW52W25hbWVdO1xuICBpZiAoIXYpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBlbnYgdmFyOiAke25hbWV9YCk7XG4gIHJldHVybiB2O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gb3B0KG5hbWU6IHN0cmluZywgZmFsbGJhY2sgPSBcIlwiKTogc3RyaW5nIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52W25hbWVdIHx8IGZhbGxiYWNrO1xufSIsICJpbXBvcnQgeyBtdXN0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmZ1bmN0aW9uIHRvSHR0cFNxbEVuZHBvaW50KHVybDogc3RyaW5nKTogeyBlbmRwb2ludDogc3RyaW5nOyBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0ge1xuICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50OiB1cmwsXG4gICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmICgvXnBvc3RncmVzKHFsKT86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTCh1cmwpO1xuICAgIGNvbnN0IGVuZHBvaW50ID0gYGh0dHBzOi8vJHtwYXJzZWQuaG9zdH0vc3FsYDtcbiAgICByZXR1cm4ge1xuICAgICAgZW5kcG9pbnQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIk5lb24tQ29ubmVjdGlvbi1TdHJpbmdcIjogdXJsLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiTkVPTl9EQVRBQkFTRV9VUkwgbXVzdCBiZSBhbiBodHRwcyBTUUwgZW5kcG9pbnQgb3IgcG9zdGdyZXMgY29ubmVjdGlvbiBzdHJpbmcuXCIpO1xufVxuXG4vKipcbiAqIEV4ZWN1dGUgYSBTUUwgcXVlcnkgYWdhaW5zdCB0aGUgTmVvbiBzZXJ2ZXJsZXNzIGRhdGFiYXNlIHZpYSB0aGVcbiAqIEhUVFAgZW5kcG9pbnQuICBUaGUgTkVPTl9EQVRBQkFTRV9VUkwgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdFxuICogYmUgc2V0IHRvIGEgdmFsaWQgTmVvbiBTUUwtb3Zlci1IVFRQIGVuZHBvaW50LiAgUmV0dXJucyB0aGVcbiAqIHBhcnNlZCBKU09OIHJlc3VsdCB3aGljaCBpbmNsdWRlcyBhICdyb3dzJyBhcnJheS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHEoc3FsOiBzdHJpbmcsIHBhcmFtczogYW55W10gPSBbXSkge1xuICBjb25zdCB1cmwgPSBtdXN0KFwiTkVPTl9EQVRBQkFTRV9VUkxcIik7XG4gIGNvbnN0IHRhcmdldCA9IHRvSHR0cFNxbEVuZHBvaW50KHVybCk7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRhcmdldC5lbmRwb2ludCwge1xuICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgaGVhZGVyczogdGFyZ2V0LmhlYWRlcnMsXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogc3FsLCBwYXJhbXMgfSksXG4gIH0pO1xuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICAgIHRocm93IG5ldyBFcnJvcihgREIgZXJyb3I6ICR7dGV4dH1gKTtcbiAgfVxuICByZXR1cm4gcmVzLmpzb24oKSBhcyBQcm9taXNlPHsgcm93czogYW55W10gfT47XG59IiwgImltcG9ydCB7IHEgfSBmcm9tIFwiLi9uZW9uXCI7XG5cbi8qKlxuICogUmVjb3JkIGFuIGF1ZGl0IGV2ZW50IGluIHRoZSBkYXRhYmFzZS4gIEFsbCBjb25zZXF1ZW50aWFsXG4gKiBvcGVyYXRpb25zIHNob3VsZCBlbWl0IGFuIGF1ZGl0IGV2ZW50IHdpdGggYWN0b3IsIG9yZywgd29ya3NwYWNlLFxuICogdHlwZSBhbmQgYXJiaXRyYXJ5IG1ldGFkYXRhLiAgRXJyb3JzIGFyZSBzd2FsbG93ZWQgc2lsZW50bHlcbiAqIGJlY2F1c2UgYXVkaXQgbG9nZ2luZyBtdXN0IG5ldmVyIGJyZWFrIHVzZXIgZmxvd3MuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhdWRpdChcbiAgYWN0b3I6IHN0cmluZyxcbiAgb3JnX2lkOiBzdHJpbmcgfCBudWxsLFxuICB3c19pZDogc3RyaW5nIHwgbnVsbCxcbiAgdHlwZTogc3RyaW5nLFxuICBtZXRhOiBhbnlcbikge1xuICB0cnkge1xuICAgIGF3YWl0IHEoXG4gICAgICBcImluc2VydCBpbnRvIGF1ZGl0X2V2ZW50cyhhY3Rvciwgb3JnX2lkLCB3c19pZCwgdHlwZSwgbWV0YSkgdmFsdWVzKCQxLCQyLCQzLCQ0LCQ1Ojpqc29uYilcIixcbiAgICAgIFthY3Rvciwgb3JnX2lkLCB3c19pZCwgdHlwZSwgSlNPTi5zdHJpbmdpZnkobWV0YSA/PyB7fSldXG4gICAgKTtcbiAgfSBjYXRjaCAoXykge1xuICAgIC8vIGlnbm9yZSBhdWRpdCBmYWlsdXJlc1xuICB9XG59IiwgImltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcbmltcG9ydCB7IGNsYW1wQXJyYXksIGNsYW1wU3RyaW5nLCByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCB9IGZyb20gXCIuL2NvbnRyYWN0b3ItbmV0d29ya1wiO1xuXG50eXBlIEFkbWluQ2xhaW1zID0ge1xuICByb2xlOiBcImFkbWluXCI7XG4gIHN1Yjogc3RyaW5nO1xuICBtb2RlPzogXCJwYXNzd29yZFwiIHwgXCJpZGVudGl0eVwiO1xuICBpYXQ/OiBudW1iZXI7XG4gIGV4cD86IG51bWJlcjtcbn07XG5cbnR5cGUgQWRtaW5QcmluY2lwYWwgPSB7XG4gIGFjdG9yOiBzdHJpbmc7XG4gIG1vZGU6IFwicGFzc3dvcmRcIiB8IFwiaWRlbnRpdHlcIjtcbn07XG5cbmZ1bmN0aW9uIGJhc2U2NHVybEVuY29kZShpbnB1dDogQnVmZmVyIHwgc3RyaW5nKSB7XG4gIHJldHVybiBCdWZmZXIuZnJvbShpbnB1dClcbiAgICAudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICAucmVwbGFjZSgvPS9nLCBcIlwiKVxuICAgIC5yZXBsYWNlKC9cXCsvZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL1xcLy9nLCBcIl9cIik7XG59XG5cbmZ1bmN0aW9uIGJhc2U2NHVybERlY29kZShpbnB1dDogc3RyaW5nKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBTdHJpbmcoaW5wdXQgfHwgXCJcIikucmVwbGFjZSgvLS9nLCBcIitcIikucmVwbGFjZSgvXy9nLCBcIi9cIik7XG4gIGNvbnN0IHBhZGRlZCA9IG5vcm1hbGl6ZWQgKyBcIj1cIi5yZXBlYXQoKDQgLSAobm9ybWFsaXplZC5sZW5ndGggJSA0IHx8IDQpKSAlIDQpO1xuICByZXR1cm4gQnVmZmVyLmZyb20ocGFkZGVkLCBcImJhc2U2NFwiKTtcbn1cblxuZnVuY3Rpb24gaG1hY1NoYTI1NihzZWNyZXQ6IHN0cmluZywgcGF5bG9hZDogc3RyaW5nKSB7XG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSG1hYyhcInNoYTI1NlwiLCBzZWNyZXQpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCb29sKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCkgPT09IFwidHJ1ZVwiO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsbG93bGlzdCh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlSHR0cEVycm9yKHN0YXR1czogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpIHtcbiAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IobWVzc2FnZSkgYXMgRXJyb3IgJiB7IHN0YXR1c0NvZGU/OiBudW1iZXIgfTtcbiAgZXJyb3Iuc3RhdHVzQ29kZSA9IHN0YXR1cztcbiAgcmV0dXJuIGVycm9yO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29udHJhY3Rvckpzb24oc3RhdHVzOiBudW1iZXIsIGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBleHRyYUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGJvZHkpLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tc3RvcmVcIixcbiAgICAgIC4uLmV4dHJhSGVhZGVycyxcbiAgICB9LFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnRyYWN0b3JFcnJvclJlc3BvbnNlKGVycm9yOiB1bmtub3duLCBmYWxsYmFja01lc3NhZ2U6IHN0cmluZykge1xuICBjb25zdCBtZXNzYWdlID0gU3RyaW5nKChlcnJvciBhcyBhbnkpPy5tZXNzYWdlIHx8IGZhbGxiYWNrTWVzc2FnZSk7XG4gIGNvbnN0IHN0YXR1c0NvZGUgPSBOdW1iZXIoKGVycm9yIGFzIGFueSk/LnN0YXR1c0NvZGUgfHwgNTAwKTtcbiAgcmV0dXJuIGNvbnRyYWN0b3JKc29uKHN0YXR1c0NvZGUsIHsgZXJyb3I6IG1lc3NhZ2UgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTdGF0dXModmFsdWU6IHVua25vd24pIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgYWxsb3dlZCA9IG5ldyBTZXQoW1wibmV3XCIsIFwicmV2aWV3aW5nXCIsIFwiYXBwcm92ZWRcIiwgXCJvbl9ob2xkXCIsIFwicmVqZWN0ZWRcIl0pO1xuICByZXR1cm4gYWxsb3dlZC5oYXMobm9ybWFsaXplZCkgPyBub3JtYWxpemVkIDogXCJyZXZpZXdpbmdcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVRhZ3ModmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wQXJyYXkodmFsdWUsIDIwLCA0OCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaWduQ29udHJhY3RvckFkbWluSnd0KFxuICBwYXlsb2FkOiBQaWNrPEFkbWluQ2xhaW1zLCBcInJvbGVcIiB8IFwic3ViXCIgfCBcIm1vZGVcIj4sXG4gIHNlY3JldDogc3RyaW5nLFxuICBleHBpcmVzSW5TZWNvbmRzID0gNjAgKiA2MCAqIDEyXG4pIHtcbiAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gIGNvbnN0IGhlYWRlciA9IGJhc2U2NHVybEVuY29kZShKU09OLnN0cmluZ2lmeSh7IGFsZzogXCJIUzI1NlwiLCB0eXA6IFwiSldUXCIgfSkpO1xuICBjb25zdCBjbGFpbXM6IEFkbWluQ2xhaW1zID0ge1xuICAgIC4uLnBheWxvYWQsXG4gICAgaWF0OiBub3csXG4gICAgZXhwOiBub3cgKyBleHBpcmVzSW5TZWNvbmRzLFxuICB9O1xuICBjb25zdCBib2R5ID0gYmFzZTY0dXJsRW5jb2RlKEpTT04uc3RyaW5naWZ5KGNsYWltcykpO1xuICBjb25zdCBtZXNzYWdlID0gYCR7aGVhZGVyfS4ke2JvZHl9YDtcbiAgY29uc3Qgc2lnbmF0dXJlID0gYmFzZTY0dXJsRW5jb2RlKGhtYWNTaGEyNTYoc2VjcmV0LCBtZXNzYWdlKSk7XG4gIHJldHVybiBgJHttZXNzYWdlfS4ke3NpZ25hdHVyZX1gO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5Q29udHJhY3RvckFkbWluSnd0KHRva2VuOiBzdHJpbmcsIHNlY3JldDogc3RyaW5nKSB7XG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKHRva2VuIHx8IFwiXCIpLnNwbGl0KFwiLlwiKTtcbiAgaWYgKHBhcnRzLmxlbmd0aCAhPT0gMyB8fCAhc2VjcmV0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgW2hlYWRlciwgYm9keSwgc2lnbmF0dXJlXSA9IHBhcnRzO1xuICBjb25zdCBtZXNzYWdlID0gYCR7aGVhZGVyfS4ke2JvZHl9YDtcbiAgY29uc3QgZXhwZWN0ZWQgPSBiYXNlNjR1cmxFbmNvZGUoaG1hY1NoYTI1NihzZWNyZXQsIG1lc3NhZ2UpKTtcbiAgY29uc3QgYWN0dWFsID0gU3RyaW5nKHNpZ25hdHVyZSB8fCBcIlwiKTtcbiAgaWYgKCFleHBlY3RlZCB8fCBleHBlY3RlZC5sZW5ndGggIT09IGFjdHVhbC5sZW5ndGgpIHJldHVybiBudWxsO1xuICBpZiAoIWNyeXB0by50aW1pbmdTYWZlRXF1YWwoQnVmZmVyLmZyb20oZXhwZWN0ZWQpLCBCdWZmZXIuZnJvbShhY3R1YWwpKSkgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3QgY2xhaW1zID0gSlNPTi5wYXJzZShiYXNlNjR1cmxEZWNvZGUoYm9keSkudG9TdHJpbmcoXCJ1dGYtOFwiKSkgYXMgQWRtaW5DbGFpbXM7XG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gICAgaWYgKGNsYWltcy5leHAgJiYgbm93ID4gY2xhaW1zLmV4cCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKGNsYWltcy5yb2xlICE9PSBcImFkbWluXCIpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBjbGFpbXM7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1aXJlQ29udHJhY3RvckFkbWluKHJlcXVlc3Q6IFJlcXVlc3QsIGNvbnRleHQ/OiBhbnkpOiBQcm9taXNlPEFkbWluUHJpbmNpcGFsPiB7XG4gIGNvbnN0IGF1dGggPSByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiYXV0aG9yaXphdGlvblwiKSB8fCByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiQXV0aG9yaXphdGlvblwiKSB8fCBcIlwiO1xuICBjb25zdCBiZWFyZXIgPSBhdXRoLnN0YXJ0c1dpdGgoXCJCZWFyZXIgXCIpID8gYXV0aC5zbGljZShcIkJlYXJlciBcIi5sZW5ndGgpLnRyaW0oKSA6IFwiXCI7XG4gIGNvbnN0IHNlY3JldCA9IFN0cmluZyhwcm9jZXNzLmVudi5BRE1JTl9KV1RfU0VDUkVUIHx8IFwiXCIpLnRyaW0oKTtcblxuICBpZiAoYmVhcmVyICYmIHNlY3JldCkge1xuICAgIGNvbnN0IGNsYWltcyA9IGF3YWl0IHZlcmlmeUNvbnRyYWN0b3JBZG1pbkp3dChiZWFyZXIsIHNlY3JldCk7XG4gICAgaWYgKGNsYWltcz8ucm9sZSA9PT0gXCJhZG1pblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3RvcjogY2xhaW1zLnN1YiB8fCBcImNvbnRyYWN0b3ItYWRtaW5cIixcbiAgICAgICAgbW9kZTogY2xhaW1zLm1vZGUgPT09IFwiaWRlbnRpdHlcIiA/IFwiaWRlbnRpdHlcIiA6IFwicGFzc3dvcmRcIixcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaWRlbnRpdHlVc2VyID0gY29udGV4dD8uY2xpZW50Q29udGV4dD8udXNlcjtcbiAgaWYgKGlkZW50aXR5VXNlcikge1xuICAgIGNvbnN0IGFsbG93QW55b25lID0gcGFyc2VCb29sKHByb2Nlc3MuZW52LkFETUlOX0lERU5USVRZX0FOWU9ORSk7XG4gICAgY29uc3QgYWxsb3dsaXN0ID0gcGFyc2VBbGxvd2xpc3QocHJvY2Vzcy5lbnYuQURNSU5fRU1BSUxfQUxMT1dMSVNUKTtcbiAgICBjb25zdCBlbWFpbCA9IGNsYW1wU3RyaW5nKGlkZW50aXR5VXNlci5lbWFpbCwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChhbGxvd0FueW9uZSB8fCAoZW1haWwgJiYgYWxsb3dsaXN0LmluY2x1ZGVzKGVtYWlsKSkpIHtcbiAgICAgIHJldHVybiB7IGFjdG9yOiBlbWFpbCB8fCBcImlkZW50aXR5LXVzZXJcIiwgbW9kZTogXCJpZGVudGl0eVwiIH07XG4gICAgfVxuICAgIHRocm93IGNyZWF0ZUh0dHBFcnJvcig0MDMsIFwiSWRlbnRpdHkgdXNlciBub3QgYWxsb3dsaXN0ZWQuXCIpO1xuICB9XG5cbiAgdGhyb3cgY3JlYXRlSHR0cEVycm9yKDQwMSwgXCJNaXNzaW5nIG9yIGludmFsaWQgYWRtaW4gYXV0aG9yaXphdGlvbi5cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29udHJhY3RvclF1ZXJ5TGltaXQocmF3OiBzdHJpbmcgfCBudWxsLCBmYWxsYmFjayA9IDEwMCwgbWF4ID0gMjAwKSB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlcihyYXcgfHwgZmFsbGJhY2spO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gZmFsbGJhY2s7XG4gIHJldHVybiBNYXRoLm1heCgxLCBNYXRoLm1pbihtYXgsIE1hdGgudHJ1bmMocGFyc2VkKSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplQ29udHJhY3RvckxhbmVzKHJhdzogdW5rbm93bikge1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gcmF3Lm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0gfHwgXCJcIikudHJpbSgpKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQubWFwKChpdGVtKSA9PiBTdHJpbmcoaXRlbSB8fCBcIlwiKS50cmltKCkpLmZpbHRlcihCb29sZWFuKSA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW10gYXMgc3RyaW5nW107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDb250cmFjdG9yVGFncyhyYXc6IHVua25vd24pIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhdy5tYXAoKGl0ZW0pID0+IFN0cmluZyhpdGVtIHx8IFwiXCIpLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgfVxuICByZXR1cm4gW10gYXMgc3RyaW5nW107XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckFkbWluU2NvcGUoKSB7XG4gIHJldHVybiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29udHJhY3RvckhlYWx0aFByb2JlKCkge1xuICBhd2FpdCBxKFwic2VsZWN0IDEgYXMgb25lXCIsIFtdKTtcbn1cbiIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuaW1wb3J0IHsgb3B0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmV4cG9ydCB0eXBlIENvbnRyYWN0b3JJbnRha2VUYXJnZXQgPSB7XG4gIG9yZ0lkOiBzdHJpbmc7XG4gIHdzSWQ6IHN0cmluZyB8IG51bGw7XG4gIG1pc3Npb25JZDogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmNvbnN0IFVVSURfUkUgPSAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLTVdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBBcnJheShpbnB1dDogdW5rbm93biwgbGltaXQ6IG51bWJlciwgbWF4TGVuZ3RoOiBudW1iZXIpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGlucHV0KSkgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xuICByZXR1cm4gaW5wdXRcbiAgICAubWFwKChpdGVtKSA9PiBjbGFtcFN0cmluZyhpdGVtLCBtYXhMZW5ndGgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAuc2xpY2UoMCwgbGltaXQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZUVtYWlsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIW5leHQgfHwgIW5leHQuaW5jbHVkZXMoXCJAXCIpIHx8IG5leHQuaW5jbHVkZXMoXCIgXCIpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlUGhvbmUodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkucmVwbGFjZSgvW15cXGQrXFwtKCkgXS9nLCBcIlwiKS5zbGljZSgwLCA0MCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNTAwKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG5leHQpO1xuICAgIGlmIChwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cDpcIiAmJiBwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cHM6XCIpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSnNvbkxpc3QodmFsdWU6IHVua25vd24sIGxpbWl0OiBudW1iZXIpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gY2xhbXBBcnJheSh2YWx1ZSwgbGltaXQsIDgwKTtcbiAgY29uc3QgcmF3ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXSBhcyBzdHJpbmdbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgcmV0dXJuIGNsYW1wQXJyYXkocGFyc2VkLCBsaW1pdCwgODApO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW10gYXMgc3RyaW5nW107XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVGaWxlbmFtZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDE4MCkgfHwgXCJmaWxlXCI7XG4gIHJldHVybiBuZXh0LnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1V1aWRMaWtlKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBVVUlEX1JFLnRlc3QoU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29ycmVsYXRpb25JZEZyb21IZWFkZXJzKGhlYWRlcnM6IEhlYWRlcnMpIHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBoZWFkZXJzLmdldChcIngtY29ycmVsYXRpb24taWRcIiksXG4gICAgaGVhZGVycy5nZXQoXCJYLUNvcnJlbGF0aW9uLUlkXCIpLFxuICAgIGhlYWRlcnMuZ2V0KFwieF9jb3JyZWxhdGlvbl9pZFwiKSxcbiAgXTtcbiAgY29uc3QgdmFsdWUgPSBjbGFtcFN0cmluZyhjYW5kaWRhdGVzLmZpbmQoQm9vbGVhbiksIDEyOCk7XG4gIGlmICghdmFsdWUpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvW15hLXpBLVowLTk6X1xcLS5dL2csIFwiXCIpLnNsaWNlKDAsIDEyOCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpIHtcbiAgY29uc3Qgb3JnSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfT1JHX0lEXCIpLCA2NCk7XG4gIGNvbnN0IHdzSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfV1NfSURcIiksIDY0KSB8fCBudWxsO1xuICBjb25zdCBtaXNzaW9uSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRFwiKSwgNjQpIHx8IG51bGw7XG5cbiAgaWYgKCFvcmdJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3IgTmV0d29yayBpbnRha2UgaXMgbm90IGNvbmZpZ3VyZWQuIE1pc3NpbmcgQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gIH1cblxuICBpZiAoIWlzVXVpZExpa2Uob3JnSWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gIH1cblxuICBpZiAod3NJZCkge1xuICAgIGlmICghaXNVdWlkTGlrZSh3c0lkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3Qgd3MgPSBhd2FpdCBxKFwic2VsZWN0IGlkIGZyb20gd29ya3NwYWNlcyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIiwgW3dzSWQsIG9yZ0lkXSk7XG4gICAgaWYgKCF3cy5yb3dzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIGRvZXMgbm90IGJlbG9uZyB0byBDT05UUkFDVE9SX05FVFdPUktfT1JHX0lELlwiKTtcbiAgICB9XG4gIH1cblxuICBpZiAobWlzc2lvbklkKSB7XG4gICAgaWYgKCFpc1V1aWRMaWtlKG1pc3Npb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19NSVNTSU9OX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3QgbWlzc2lvbiA9IGF3YWl0IHEoXG4gICAgICBcInNlbGVjdCBpZCwgd3NfaWQgZnJvbSBtaXNzaW9ucyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIixcbiAgICAgIFttaXNzaW9uSWQsIG9yZ0lkXVxuICAgICk7XG4gICAgaWYgKCFtaXNzaW9uLnJvd3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRCBkb2VzIG5vdCBiZWxvbmcgdG8gQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBvcmdJZCxcbiAgICAgIHdzSWQ6IHdzSWQgfHwgbWlzc2lvbi5yb3dzWzBdPy53c19pZCB8fCBudWxsLFxuICAgICAgbWlzc2lvbklkLFxuICAgIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG4gIH1cblxuICByZXR1cm4geyBvcmdJZCwgd3NJZCwgbWlzc2lvbklkOiBudWxsIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG59XG4iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBNb25leSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUgfHwgMCk7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiAwO1xuICByZXR1cm4gTWF0aC5yb3VuZChwYXJzZWQgKiAxMDApIC8gMTAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDUwMCk7XG4gIGlmICghbmV4dCkgcmV0dXJuIFwiXCI7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChuZXh0KTtcbiAgICBpZiAoIVtcImh0dHA6XCIsIFwiaHR0cHM6XCJdLmluY2x1ZGVzKHBhcnNlZC5wcm90b2NvbCkpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVEYXRlKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjApO1xuICBpZiAoIS9eXFxkezR9LVxcZHsyfS1cXGR7Mn0kLy50ZXN0KG5leHQpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXVpZCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDY0KTtcbiAgcmV0dXJuIC9eWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzEtNV1bMC05YS1mXXszfS1bODlhYl1bMC05YS1mXXszfS1bMC05YS1mXXsxMn0kL2kudGVzdChuZXh0KSA/IG5leHQgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3N2RXNjYXBlKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IHJhdyA9IFN0cmluZyh2YWx1ZSA/PyBcIlwiKTtcbiAgY29uc3QgZXNjYXBlZCA9IHJhdy5yZXBsYWNlKC9cIi9nLCAnXCJcIicpO1xuICByZXR1cm4gL1tcIixcXG5dLy50ZXN0KHJhdykgPyBgXCIke2VzY2FwZWR9XCJgIDogZXNjYXBlZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnRyYWN0b3JIZWFkZXIoY29udHJhY3RvcklkOiBzdHJpbmcsIG9yZ0lkOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcShcbiAgICBgc2VsZWN0IGlkLCBvcmdfaWQsIHdzX2lkLCBtaXNzaW9uX2lkLCBmdWxsX25hbWUsIGJ1c2luZXNzX25hbWUsIGVtYWlsLCBwaG9uZSwgZW50aXR5X3R5cGUsIHN0YXR1cywgdmVyaWZpZWRcbiAgICAgICBmcm9tIGNvbnRyYWN0b3Jfc3VibWlzc2lvbnNcbiAgICAgIHdoZXJlIGlkPSQxXG4gICAgICAgIGFuZCBvcmdfaWQ9JDJcbiAgICAgIGxpbWl0IDFgLFxuICAgIFtjb250cmFjdG9ySWQsIG9yZ0lkXVxuICApO1xuICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFZlcmlmaWNhdGlvblBhY2tldChjb250cmFjdG9ySWQ6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcShcbiAgICBgc2VsZWN0ICpcbiAgICAgICBmcm9tIGNvbnRyYWN0b3JfdmVyaWZpY2F0aW9uX3BhY2tldHNcbiAgICAgIHdoZXJlIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZD0kMVxuICAgICAgICBhbmQgcGVyaW9kX3N0YXJ0PSQyXG4gICAgICAgIGFuZCBwZXJpb2RfZW5kPSQzXG4gICAgICBsaW1pdCAxYCxcbiAgICBbY29udHJhY3RvcklkLCBzdGFydCwgZW5kXVxuICApO1xuICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFN1bW1hcnlCdW5kbGUoY29udHJhY3RvcklkOiBzdHJpbmcsIG9yZ0lkOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKSB7XG4gIGNvbnN0IGNvbnRyYWN0b3IgPSBhd2FpdCBnZXRDb250cmFjdG9ySGVhZGVyKGNvbnRyYWN0b3JJZCwgb3JnSWQpO1xuICBpZiAoIWNvbnRyYWN0b3IpIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3Igbm90IGZvdW5kLlwiKTtcblxuICBjb25zdCBpbmNvbWUgPSBhd2FpdCBxKFxuICAgIGBzZWxlY3QgKlxuICAgICAgIGZyb20gY29udHJhY3Rvcl9pbmNvbWVfZW50cmllc1xuICAgICAgd2hlcmUgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkPSQxXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlID49ICQyXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlIDw9ICQzXG4gICAgICBvcmRlciBieSBlbnRyeV9kYXRlIGRlc2MsIGNyZWF0ZWRfYXQgZGVzY2AsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcblxuICBjb25zdCBleHBlbnNlcyA9IGF3YWl0IHEoXG4gICAgYHNlbGVjdCAqXG4gICAgICAgZnJvbSBjb250cmFjdG9yX2V4cGVuc2VfZW50cmllc1xuICAgICAgd2hlcmUgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkPSQxXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlID49ICQyXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlIDw9ICQzXG4gICAgICBvcmRlciBieSBlbnRyeV9kYXRlIGRlc2MsIGNyZWF0ZWRfYXQgZGVzY2AsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcblxuICBjb25zdCBwYWNrZXQgPSBhd2FpdCBnZXRWZXJpZmljYXRpb25QYWNrZXQoY29udHJhY3RvcklkLCBzdGFydCwgZW5kKTtcbiAgY29uc3QgdG90YWxzID0ge1xuICAgIGdyb3NzX2luY29tZTogMCxcbiAgICBmZWVzOiAwLFxuICAgIG5ldF9pbmNvbWU6IDAsXG4gICAgZXhwZW5zZXM6IDAsXG4gICAgZGVkdWN0aWJsZV9leHBlbnNlczogMCxcbiAgICBuZXRfYWZ0ZXJfZXhwZW5zZXM6IDAsXG4gIH07XG5cbiAgZm9yIChjb25zdCByb3cgb2YgaW5jb21lLnJvd3MpIHtcbiAgICB0b3RhbHMuZ3Jvc3NfaW5jb21lICs9IE51bWJlcihyb3cuZ3Jvc3NfYW1vdW50IHx8IDApO1xuICAgIHRvdGFscy5mZWVzICs9IE51bWJlcihyb3cuZmVlX2Ftb3VudCB8fCAwKTtcbiAgICB0b3RhbHMubmV0X2luY29tZSArPSBOdW1iZXIocm93Lm5ldF9hbW91bnQgfHwgMCk7XG4gIH1cblxuICBmb3IgKGNvbnN0IHJvdyBvZiBleHBlbnNlcy5yb3dzKSB7XG4gICAgY29uc3QgYW1vdW50ID0gTnVtYmVyKHJvdy5hbW91bnQgfHwgMCk7XG4gICAgY29uc3QgZGVkdWN0aWJsZVBlcmNlbnQgPSBOdW1iZXIocm93LmRlZHVjdGlibGVfcGVyY2VudCB8fCAwKSAvIDEwMDtcbiAgICB0b3RhbHMuZXhwZW5zZXMgKz0gYW1vdW50O1xuICAgIHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzICs9IGFtb3VudCAqIGRlZHVjdGlibGVQZXJjZW50O1xuICB9XG5cbiAgdG90YWxzLmdyb3NzX2luY29tZSA9IGNsYW1wTW9uZXkodG90YWxzLmdyb3NzX2luY29tZSk7XG4gIHRvdGFscy5mZWVzID0gY2xhbXBNb25leSh0b3RhbHMuZmVlcyk7XG4gIHRvdGFscy5uZXRfaW5jb21lID0gY2xhbXBNb25leSh0b3RhbHMubmV0X2luY29tZSk7XG4gIHRvdGFscy5leHBlbnNlcyA9IGNsYW1wTW9uZXkodG90YWxzLmV4cGVuc2VzKTtcbiAgdG90YWxzLmRlZHVjdGlibGVfZXhwZW5zZXMgPSBjbGFtcE1vbmV5KHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzKTtcbiAgdG90YWxzLm5ldF9hZnRlcl9leHBlbnNlcyA9IGNsYW1wTW9uZXkodG90YWxzLm5ldF9pbmNvbWUgLSB0b3RhbHMuZXhwZW5zZXMpO1xuXG4gIGNvbnN0IGRpZ2VzdCA9IGNyeXB0b1xuICAgIC5jcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgLnVwZGF0ZShcbiAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY29udHJhY3Rvcl9pZDogY29udHJhY3RvcklkLFxuICAgICAgICBvcmdfaWQ6IG9yZ0lkLFxuICAgICAgICBzdGFydCxcbiAgICAgICAgZW5kLFxuICAgICAgICB0b3RhbHMsXG4gICAgICAgIGluY29tZV9jb3VudDogaW5jb21lLnJvd3MubGVuZ3RoLFxuICAgICAgICBleHBlbnNlX2NvdW50OiBleHBlbnNlcy5yb3dzLmxlbmd0aCxcbiAgICAgIH0pXG4gICAgKVxuICAgIC5kaWdlc3QoXCJoZXhcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250cmFjdG9yLFxuICAgIHBhY2tldCxcbiAgICBpbmNvbWU6IGluY29tZS5yb3dzLFxuICAgIGV4cGVuc2VzOiBleHBlbnNlcy5yb3dzLFxuICAgIHRvdGFscyxcbiAgICBkaWdlc3QsXG4gICAgcGVyaW9kOiB7IHN0YXJ0LCBlbmQgfSxcbiAgfTtcbn0iLCAiaW1wb3J0IHsgYXVkaXQgfSBmcm9tIFwiLi9fc2hhcmVkL2F1ZGl0XCI7XG5pbXBvcnQge1xuICBjb250cmFjdG9yRXJyb3JSZXNwb25zZSxcbiAgcmVxdWlyZUNvbnRyYWN0b3JBZG1pbixcbiAgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlLFxufSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItYWRtaW5cIjtcbmltcG9ydCB7IGNzdkVzY2FwZSwgZ2V0U3VtbWFyeUJ1bmRsZSwgc2FmZURhdGUsIHNhZmVVdWlkIH0gZnJvbSBcIi4vX3NoYXJlZC9jb250cmFjdG9yLWluY29tZVwiO1xuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAocmVxdWVzdDogUmVxdWVzdCwgY29udGV4dDogYW55KSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYWRtaW4gPSBhd2FpdCByZXF1aXJlQ29udHJhY3RvckFkbWluKHJlcXVlc3QsIGNvbnRleHQpO1xuICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCAhPT0gXCJHRVRcIikge1xuICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZC5cIiB9KSwgeyBzdGF0dXM6IDQwNSwgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9IH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlID0gYXdhaXQgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlKCk7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCk7XG4gICAgY29uc3QgY29udHJhY3RvclN1Ym1pc3Npb25JZCA9IHNhZmVVdWlkKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkXCIpKTtcbiAgICBjb25zdCBzdGFydCA9IHNhZmVEYXRlKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic3RhcnRcIikpO1xuICAgIGNvbnN0IGVuZCA9IHNhZmVEYXRlKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZW5kXCIpKTtcblxuICAgIGlmICghY29udHJhY3RvclN1Ym1pc3Npb25JZCkgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIk1pc3NpbmcgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkLlwiIH0pLCB7IHN0YXR1czogNDAwLCBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0gfSk7XG4gICAgaWYgKCFzdGFydCB8fCAhZW5kKSByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiTWlzc2luZyBzdGFydCBvciBlbmQgZGF0ZS5cIiB9KSwgeyBzdGF0dXM6IDQwMCwgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9IH0pO1xuXG4gICAgY29uc3QgYnVuZGxlID0gYXdhaXQgZ2V0U3VtbWFyeUJ1bmRsZShjb250cmFjdG9yU3VibWlzc2lvbklkLCBzY29wZS5vcmdJZCwgc3RhcnQsIGVuZCk7XG4gICAgYXdhaXQgYXVkaXQoYWRtaW4uYWN0b3IsIHNjb3BlLm9yZ0lkLCBidW5kbGUuY29udHJhY3Rvci53c19pZCB8fCBudWxsLCBcImNvbnRyYWN0b3IuZmluYW5jZS5leHBvcnRcIiwge1xuICAgICAgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkOiBjb250cmFjdG9yU3VibWlzc2lvbklkLFxuICAgICAgbWlzc2lvbl9pZDogYnVuZGxlLmNvbnRyYWN0b3IubWlzc2lvbl9pZCB8fCBudWxsLFxuICAgICAgcGVyaW9kX3N0YXJ0OiBzdGFydCxcbiAgICAgIHBlcmlvZF9lbmQ6IGVuZCxcbiAgICAgIGRpZ2VzdDogYnVuZGxlLmRpZ2VzdCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxpbmVzID0gW10gYXMgc3RyaW5nW107XG4gICAgbGluZXMucHVzaChbXCJzZWN0aW9uXCIsIFwiY29udHJhY3Rvcl9pZFwiLCBcImNvbnRyYWN0b3JfbmFtZVwiLCBcImVudHJ5X2RhdGVcIiwgXCJuYW1lXCIsIFwidHlwZVwiLCBcInJlZmVyZW5jZVwiLCBcImdyb3NzXCIsIFwiZmVlc1wiLCBcIm5ldFwiLCBcImV4cGVuc2VfYW1vdW50XCIsIFwiZGVkdWN0aWJsZV9wZXJjZW50XCIsIFwiY2F0ZWdvcnlcIiwgXCJ2ZXJpZmljYXRpb25fc3RhdHVzXCIsIFwibm90ZXNcIiwgXCJwcm9vZl91cmxcIl0uam9pbihcIixcIikpO1xuXG4gICAgZm9yIChjb25zdCByb3cgb2YgYnVuZGxlLmluY29tZSB8fCBbXSkge1xuICAgICAgbGluZXMucHVzaChcbiAgICAgICAgW1xuICAgICAgICAgIFwiaW5jb21lXCIsXG4gICAgICAgICAgYnVuZGxlLmNvbnRyYWN0b3IuaWQsXG4gICAgICAgICAgYnVuZGxlLmNvbnRyYWN0b3IuZnVsbF9uYW1lLFxuICAgICAgICAgIHJvdy5lbnRyeV9kYXRlLFxuICAgICAgICAgIHJvdy5zb3VyY2VfbmFtZSxcbiAgICAgICAgICByb3cuc291cmNlX3R5cGUsXG4gICAgICAgICAgcm93LnJlZmVyZW5jZV9jb2RlIHx8IFwiXCIsXG4gICAgICAgICAgcm93Lmdyb3NzX2Ftb3VudCxcbiAgICAgICAgICByb3cuZmVlX2Ftb3VudCxcbiAgICAgICAgICByb3cubmV0X2Ftb3VudCxcbiAgICAgICAgICBcIlwiLFxuICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgcm93LmNhdGVnb3J5IHx8IFwiXCIsXG4gICAgICAgICAgcm93LnZlcmlmaWNhdGlvbl9zdGF0dXMgfHwgXCJcIixcbiAgICAgICAgICByb3cubm90ZXMgfHwgXCJcIixcbiAgICAgICAgICByb3cucHJvb2ZfdXJsIHx8IFwiXCIsXG4gICAgICAgIF1cbiAgICAgICAgICAubWFwKGNzdkVzY2FwZSlcbiAgICAgICAgICAuam9pbihcIixcIilcbiAgICAgICk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgYnVuZGxlLmV4cGVuc2VzIHx8IFtdKSB7XG4gICAgICBsaW5lcy5wdXNoKFxuICAgICAgICBbXG4gICAgICAgICAgXCJleHBlbnNlXCIsXG4gICAgICAgICAgYnVuZGxlLmNvbnRyYWN0b3IuaWQsXG4gICAgICAgICAgYnVuZGxlLmNvbnRyYWN0b3IuZnVsbF9uYW1lLFxuICAgICAgICAgIHJvdy5lbnRyeV9kYXRlLFxuICAgICAgICAgIHJvdy52ZW5kb3JfbmFtZSxcbiAgICAgICAgICBcImV4cGVuc2VcIixcbiAgICAgICAgICBcIlwiLFxuICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgXCJcIixcbiAgICAgICAgICBcIlwiLFxuICAgICAgICAgIHJvdy5hbW91bnQsXG4gICAgICAgICAgcm93LmRlZHVjdGlibGVfcGVyY2VudCxcbiAgICAgICAgICByb3cuY2F0ZWdvcnkgfHwgXCJcIixcbiAgICAgICAgICByb3cudmVyaWZpY2F0aW9uX3N0YXR1cyB8fCBcIlwiLFxuICAgICAgICAgIHJvdy5ub3RlcyB8fCBcIlwiLFxuICAgICAgICAgIHJvdy5wcm9vZl91cmwgfHwgXCJcIixcbiAgICAgICAgXVxuICAgICAgICAgIC5tYXAoY3N2RXNjYXBlKVxuICAgICAgICAgIC5qb2luKFwiLFwiKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICAgIGxpbmVzLnB1c2goW1wic3VtbWFyeV9rZXlcIiwgXCJzdW1tYXJ5X3ZhbHVlXCJdLmpvaW4oXCIsXCIpKTtcbiAgICBPYmplY3QuZW50cmllcyhidW5kbGUudG90YWxzIHx8IHt9KS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IGxpbmVzLnB1c2goW2NzdkVzY2FwZShrZXkpLCBjc3ZFc2NhcGUodmFsdWUpXS5qb2luKFwiLFwiKSkpO1xuICAgIGxpbmVzLnB1c2goW2NzdkVzY2FwZShcInBlcmlvZF9zdGFydFwiKSwgY3N2RXNjYXBlKGJ1bmRsZS5wZXJpb2Quc3RhcnQpXS5qb2luKFwiLFwiKSk7XG4gICAgbGluZXMucHVzaChbY3N2RXNjYXBlKFwicGVyaW9kX2VuZFwiKSwgY3N2RXNjYXBlKGJ1bmRsZS5wZXJpb2QuZW5kKV0uam9pbihcIixcIikpO1xuICAgIGxpbmVzLnB1c2goW2NzdkVzY2FwZShcImRpZ2VzdFwiKSwgY3N2RXNjYXBlKGJ1bmRsZS5kaWdlc3QpXS5qb2luKFwiLFwiKSk7XG4gICAgaWYgKGJ1bmRsZS5wYWNrZXQpIHtcbiAgICAgIGxpbmVzLnB1c2goW2NzdkVzY2FwZShcInBhY2tldF9zdGF0dXNcIiksIGNzdkVzY2FwZShidW5kbGUucGFja2V0LnN0YXR1cyB8fCBcIlwiKV0uam9pbihcIixcIikpO1xuICAgICAgbGluZXMucHVzaChbY3N2RXNjYXBlKFwidmVyaWZpY2F0aW9uX3RpZXJcIiksIGNzdkVzY2FwZShidW5kbGUucGFja2V0LnZlcmlmaWNhdGlvbl90aWVyIHx8IFwiXCIpXS5qb2luKFwiLFwiKSk7XG4gICAgICBsaW5lcy5wdXNoKFtjc3ZFc2NhcGUoXCJwYWNrZXRfaGFzaFwiKSwgY3N2RXNjYXBlKGJ1bmRsZS5wYWNrZXQucGFja2V0X2hhc2ggfHwgXCJcIildLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlbmFtZSA9IGBjb250cmFjdG9yLWluY29tZS1leHBvcnQtJHtidW5kbGUuY29udHJhY3Rvci5pZH0tJHtzdGFydH0tdG8tJHtlbmR9LmNzdmA7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShsaW5lcy5qb2luKFwiXFxuXCIpLCB7XG4gICAgICBzdGF0dXM6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJ0ZXh0L2NzdjsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgICBcIkNvbnRlbnQtRGlzcG9zaXRpb25cIjogYGF0dGFjaG1lbnQ7IGZpbGVuYW1lPVwiJHtmaWxlbmFtZX1cImAsXG4gICAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLXN0b3JlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiBjb250cmFjdG9yRXJyb3JSZXNwb25zZShlcnJvciwgXCJGYWlsZWQgdG8gZXhwb3J0IGNvbnRyYWN0b3IgZmluYW5jaWFsIHJlY29yZHMuXCIpO1xuICB9XG59OyJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFNTyxTQUFTLEtBQUssTUFBc0I7QUFDekMsUUFBTSxJQUFJLFFBQVEsSUFBSSxJQUFJO0FBQzFCLE1BQUksQ0FBQyxFQUFHLE9BQU0sSUFBSSxNQUFNLG9CQUFvQixJQUFJLEVBQUU7QUFDbEQsU0FBTztBQUNUO0FBRU8sU0FBUyxJQUFJLE1BQWMsV0FBVyxJQUFZO0FBQ3ZELFNBQU8sUUFBUSxJQUFJLElBQUksS0FBSztBQUM5Qjs7O0FDWkEsU0FBUyxrQkFB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TSxLQUFLLENBQUMsVUFBVSxRQUFRLEdBQUcsVUFBVSxPQUFPLE1BQU0sQ0FBQyxFQUFFLEtBQUssR0FBRyxDQUFDO0FBQ3BFLFFBQUksT0FBTyxRQUFRO0FBQ2pCLFlBQU0sS0FBSyxDQUFDLFVBQVUsZUFBZSxHQUFHLFVBQVUsT0FBTyxPQUFPLFVBQVUsRUFBRSxDQUFDLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFDeEYsWUFBTSxLQUFLLENBQUMsVUFBVSxtQkFBbUIsR0FBRyxVQUFVLE9BQU8sT0FBTyxxQkFBcUIsRUFBRSxDQUFDLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFDdkcsWUFBTSxLQUFLLENBQUMsVUFBVSxhQUFhLEdBQUcsVUFBVSxPQUFPLE9BQU8sZUFBZSxFQUFFLENBQUMsRUFBRSxLQUFLLEdBQUcsQ0FBQztBQUFBLElBQzdGO0FBRUEsVUFBTSxXQUFXLDRCQUE0QixPQUFPLFdBQVcsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHO0FBQ3BGLFdBQU8sSUFBSSxTQUFTLE1BQU0sS0FBSyxJQUFJLEdBQUc7QUFBQSxNQUNwQyxRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsUUFDUCxnQkFBZ0I7QUFBQSxRQUNoQix1QkFBdUIseUJBQXlCLFFBQVE7QUFBQSxRQUN4RCxpQkFBaUI7QUFBQSxNQUNuQjtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0gsU0FBUyxPQUFPO0FBQ2QsV0FBTyx3QkFBd0IsT0FBTyxnREFBZ0Q7QUFBQSxFQUN4RjtBQUNGOyIsCiAgIm5hbWVzIjogWyJjcnlwdG8iLCAiY2xhbXBTdHJpbmciLCAiY2xhbXBTdHJpbmciLCAiY3J5cHRvIl0KfQo=
