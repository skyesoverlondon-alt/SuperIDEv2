
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

// netlify/functions/contractor-income-report.ts
function money(value) {
  return `$${Number(value || 0).toLocaleString(void 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
var contractor_income_report_default = async (request, context) => {
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
    await audit(admin.actor, scope.orgId, bundle.contractor.ws_id || null, "contractor.finance.report", {
      contractor_submission_id: contractorSubmissionId,
      mission_id: bundle.contractor.mission_id || null,
      period_start: start,
      period_end: end,
      digest: bundle.digest
    });
    const packet = bundle.packet || {
      status: "draft",
      verification_tier: "company_verified",
      issued_by_name: "Skyes Over London",
      issued_by_title: "Chief Executive Officer",
      company_name: "Skyes Over London",
      company_email: "SkyesOverLondonLC@solenterprises.org",
      company_phone: "4804695416",
      statement_text: "This report summarizes contractor activity maintained inside the company platform for the reporting window shown.",
      packet_hash: bundle.digest
    };
    const incomeRows = (bundle.income || []).map(
      (row) => `
      <tr>
        <td>${esc(row.entry_date)}</td>
        <td>${esc(row.source_name)}</td>
        <td>${esc(row.category || "")}</td>
        <td>${money(row.gross_amount)}</td>
        <td>${money(row.fee_amount)}</td>
        <td>${money(row.net_amount)}</td>
      </tr>`
    ).join("");
    const expenseRows = (bundle.expenses || []).map(
      (row) => `
      <tr>
        <td>${esc(row.entry_date)}</td>
        <td>${esc(row.vendor_name)}</td>
        <td>${esc(row.category || "")}</td>
        <td>${money(row.amount)}</td>
        <td>${esc(row.deductible_percent)}%</td>
      </tr>`
    ).join("");
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Contractor Income Verification Packet</title>
  <style>
    :root {
      --bg: #05070f;
      --panel: rgba(255,255,255,.05);
      --line: rgba(255,255,255,.14);
      --text: #f5f7ff;
      --muted: #a9b2cf;
      --gold: #f4c95d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 28px; color: var(--text); background:
      radial-gradient(circle at top, rgba(139,92,246,.20), transparent 30%),
      radial-gradient(circle at 80% 10%, rgba(244,201,93,.16), transparent 30%),
      var(--bg);
      font: 14px/1.5 Inter, Arial, sans-serif;
    }
    .page { max-width: 1100px; margin: 0 auto; }
    .hero, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; }
    .hero { padding: 24px; margin-bottom: 18px; }
    .hero h1 { margin: 0 0 8px; font-size: 28px; }
    .hero p, .muted { color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .panel { padding: 18px; }
    .kpis { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 18px 0; }
    .kpi { background: rgba(255,255,255,.035); border:1px solid var(--line); border-radius:14px; padding: 14px; }
    .kpi .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .14em; }
    .kpi .value { margin-top: 6px; font-size: 22px; font-weight: 800; }
    .section-title { margin: 0 0 10px; font-size: 16px; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
    .stamp { display:inline-block; padding: 7px 10px; border-radius: 999px; border: 1px solid rgba(244,201,93,.4); color: var(--gold); }
    .printbar { display:flex; gap:12px; margin-bottom:16px; }
    button { background: linear-gradient(135deg, rgba(244,201,93,.18), rgba(139,92,246,.18)); color: var(--text); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; cursor: pointer; }
    @media print {
      body { background: #fff; color: #111; padding: 0; }
      .hero, .panel, .kpi { background: #fff; border-color: #ccc; }
      .muted, th { color: #555; }
      .printbar { display:none; }
      .section-title { color: #333; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="printbar">
      <button onclick="window.print()">Print / Save PDF</button>
    </div>
    <section class="hero">
      <h1>${esc(packet.company_name)} - Contractor Income Verification Packet</h1>
      <p>Reporting window: ${esc(bundle.period.start)} through ${esc(bundle.period.end)}</p>
      <div class="stamp">${esc(packet.verification_tier)} - ${esc(packet.status)}</div>
      <div style="margin-top:14px" class="muted">Packet hash: ${esc(packet.packet_hash || bundle.digest)}</div>
    </section>

    <div class="grid">
      <section class="panel">
        <h2 class="section-title">Contractor Profile</h2>
        <div><strong>Name:</strong> ${esc(bundle.contractor.full_name)}</div>
        <div><strong>Business:</strong> ${esc(bundle.contractor.business_name || "-")}</div>
        <div><strong>Email:</strong> ${esc(bundle.contractor.email || "-")}</div>
        <div><strong>Phone:</strong> ${esc(bundle.contractor.phone || "-")}</div>
        <div><strong>Entity Type:</strong> ${esc(bundle.contractor.entity_type || "independent_contractor")}</div>
      </section>
      <section class="panel">
        <h2 class="section-title">Issuer Contact</h2>
        <div><strong>Issued By:</strong> ${esc(packet.issued_by_name)}</div>
        <div><strong>Title:</strong> ${esc(packet.issued_by_title)}</div>
        <div><strong>Company:</strong> ${esc(packet.company_name)}</div>
        <div><strong>Email:</strong> ${esc(packet.company_email)}</div>
        <div><strong>Phone:</strong> ${esc(packet.company_phone)}</div>
      </section>
    </div>

    <section class="kpis">
      <div class="kpi"><div class="label">Gross Income</div><div class="value">${money(bundle.totals.gross_income)}</div></div>
      <div class="kpi"><div class="label">Platform / Service Fees</div><div class="value">${money(bundle.totals.fees)}</div></div>
      <div class="kpi"><div class="label">Net Income</div><div class="value">${money(bundle.totals.net_income)}</div></div>
      <div class="kpi"><div class="label">Expenses</div><div class="value">${money(bundle.totals.expenses)}</div></div>
    </section>

    <section class="panel" style="margin-bottom:16px">
      <h2 class="section-title">Verification Statement</h2>
      <p>${esc(packet.statement_text)}</p>
      <p class="muted">This packet is a company-generated summary based on records maintained inside the contractor network platform for the date window shown. External institutions may request supplemental source records such as bank statements, tax returns, or raw payout evidence.</p>
    </section>

    <section class="panel" style="margin-bottom:16px">
      <h2 class="section-title">Income Ledger</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Source</th><th>Category</th><th>Gross</th><th>Fees</th><th>Net</th></tr>
        </thead>
        <tbody>${incomeRows || '<tr><td colspan="6">No income rows in this period.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="panel" style="margin-bottom:16px">
      <h2 class="section-title">Expense Ledger</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Deductible %</th></tr>
        </thead>
        <tbody>${expenseRows || '<tr><td colspan="5">No expense rows in this period.</td></tr>'}</tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to render contractor financial report.");
  }
};
export {
  contractor_income_report_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9lbnYudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9uZW9uLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvYXVkaXQudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvX3NoYXJlZC9jb250cmFjdG9yLWFkbWluLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1uZXR3b3JrLnRzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL19zaGFyZWQvY29udHJhY3Rvci1pbmNvbWUudHMiLCAibmV0bGlmeS9mdW5jdGlvbnMvY29udHJhY3Rvci1pbmNvbWUtcmVwb3J0LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIGhlbHBlcnMgZm9yIE5ldGxpZnkgZnVuY3Rpb25zLiAgVXNlIG11c3QoKVxuICogd2hlbiBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZDsgaXQgdGhyb3dzIGFuIGVycm9yXG4gKiBpbnN0ZWFkIG9mIHJldHVybmluZyB1bmRlZmluZWQuICBVc2Ugb3B0KCkgZm9yIG9wdGlvbmFsIHZhbHVlc1xuICogd2l0aCBhbiBvcHRpb25hbCBmYWxsYmFjay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG11c3QobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdiA9IHByb2Nlc3MuZW52W25hbWVdO1xuICBpZiAoIXYpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBlbnYgdmFyOiAke25hbWV9YCk7XG4gIHJldHVybiB2O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gb3B0KG5hbWU6IHN0cmluZywgZmFsbGJhY2sgPSBcIlwiKTogc3RyaW5nIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52W25hbWVdIHx8IGZhbGxiYWNrO1xufSIsICJpbXBvcnQgeyBtdXN0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmZ1bmN0aW9uIHRvSHR0cFNxbEVuZHBvaW50KHVybDogc3RyaW5nKTogeyBlbmRwb2ludDogc3RyaW5nOyBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0ge1xuICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuZHBvaW50OiB1cmwsXG4gICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIGlmICgvXnBvc3RncmVzKHFsKT86XFwvXFwvL2kudGVzdCh1cmwpKSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTCh1cmwpO1xuICAgIGNvbnN0IGVuZHBvaW50ID0gYGh0dHBzOi8vJHtwYXJzZWQuaG9zdH0vc3FsYDtcbiAgICByZXR1cm4ge1xuICAgICAgZW5kcG9pbnQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIk5lb24tQ29ubmVjdGlvbi1TdHJpbmdcIjogdXJsLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiTkVPTl9EQVRBQkFTRV9VUkwgbXVzdCBiZSBhbiBodHRwcyBTUUwgZW5kcG9pbnQgb3IgcG9zdGdyZXMgY29ubmVjdGlvbiBzdHJpbmcuXCIpO1xufVxuXG4vKipcbiAqIEV4ZWN1dGUgYSBTUUwgcXVlcnkgYWdhaW5zdCB0aGUgTmVvbiBzZXJ2ZXJsZXNzIGRhdGFiYXNlIHZpYSB0aGVcbiAqIEhUVFAgZW5kcG9pbnQuICBUaGUgTkVPTl9EQVRBQkFTRV9VUkwgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdFxuICogYmUgc2V0IHRvIGEgdmFsaWQgTmVvbiBTUUwtb3Zlci1IVFRQIGVuZHBvaW50LiAgUmV0dXJucyB0aGVcbiAqIHBhcnNlZCBKU09OIHJlc3VsdCB3aGljaCBpbmNsdWRlcyBhICdyb3dzJyBhcnJheS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHEoc3FsOiBzdHJpbmcsIHBhcmFtczogYW55W10gPSBbXSkge1xuICBjb25zdCB1cmwgPSBtdXN0KFwiTkVPTl9EQVRBQkFTRV9VUkxcIik7XG4gIGNvbnN0IHRhcmdldCA9IHRvSHR0cFNxbEVuZHBvaW50KHVybCk7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRhcmdldC5lbmRwb2ludCwge1xuICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgaGVhZGVyczogdGFyZ2V0LmhlYWRlcnMsXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogc3FsLCBwYXJhbXMgfSksXG4gIH0pO1xuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICAgIHRocm93IG5ldyBFcnJvcihgREIgZXJyb3I6ICR7dGV4dH1gKTtcbiAgfVxuICByZXR1cm4gcmVzLmpzb24oKSBhcyBQcm9taXNlPHsgcm93czogYW55W10gfT47XG59IiwgImltcG9ydCB7IHEgfSBmcm9tIFwiLi9uZW9uXCI7XG5cbi8qKlxuICogUmVjb3JkIGFuIGF1ZGl0IGV2ZW50IGluIHRoZSBkYXRhYmFzZS4gIEFsbCBjb25zZXF1ZW50aWFsXG4gKiBvcGVyYXRpb25zIHNob3VsZCBlbWl0IGFuIGF1ZGl0IGV2ZW50IHdpdGggYWN0b3IsIG9yZywgd29ya3NwYWNlLFxuICogdHlwZSBhbmQgYXJiaXRyYXJ5IG1ldGFkYXRhLiAgRXJyb3JzIGFyZSBzd2FsbG93ZWQgc2lsZW50bHlcbiAqIGJlY2F1c2UgYXVkaXQgbG9nZ2luZyBtdXN0IG5ldmVyIGJyZWFrIHVzZXIgZmxvd3MuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhdWRpdChcbiAgYWN0b3I6IHN0cmluZyxcbiAgb3JnX2lkOiBzdHJpbmcgfCBudWxsLFxuICB3c19pZDogc3RyaW5nIHwgbnVsbCxcbiAgdHlwZTogc3RyaW5nLFxuICBtZXRhOiBhbnlcbikge1xuICB0cnkge1xuICAgIGF3YWl0IHEoXG4gICAgICBcImluc2VydCBpbnRvIGF1ZGl0X2V2ZW50cyhhY3Rvciwgb3JnX2lkLCB3c19pZCwgdHlwZSwgbWV0YSkgdmFsdWVzKCQxLCQyLCQzLCQ0LCQ1Ojpqc29uYilcIixcbiAgICAgIFthY3Rvciwgb3JnX2lkLCB3c19pZCwgdHlwZSwgSlNPTi5zdHJpbmdpZnkobWV0YSA/PyB7fSldXG4gICAgKTtcbiAgfSBjYXRjaCAoXykge1xuICAgIC8vIGlnbm9yZSBhdWRpdCBmYWlsdXJlc1xuICB9XG59IiwgImltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgcSB9IGZyb20gXCIuL25lb25cIjtcbmltcG9ydCB7IGNsYW1wQXJyYXksIGNsYW1wU3RyaW5nLCByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCB9IGZyb20gXCIuL2NvbnRyYWN0b3ItbmV0d29ya1wiO1xuXG50eXBlIEFkbWluQ2xhaW1zID0ge1xuICByb2xlOiBcImFkbWluXCI7XG4gIHN1Yjogc3RyaW5nO1xuICBtb2RlPzogXCJwYXNzd29yZFwiIHwgXCJpZGVudGl0eVwiO1xuICBpYXQ/OiBudW1iZXI7XG4gIGV4cD86IG51bWJlcjtcbn07XG5cbnR5cGUgQWRtaW5QcmluY2lwYWwgPSB7XG4gIGFjdG9yOiBzdHJpbmc7XG4gIG1vZGU6IFwicGFzc3dvcmRcIiB8IFwiaWRlbnRpdHlcIjtcbn07XG5cbmZ1bmN0aW9uIGJhc2U2NHVybEVuY29kZShpbnB1dDogQnVmZmVyIHwgc3RyaW5nKSB7XG4gIHJldHVybiBCdWZmZXIuZnJvbShpbnB1dClcbiAgICAudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICAucmVwbGFjZSgvPS9nLCBcIlwiKVxuICAgIC5yZXBsYWNlKC9cXCsvZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL1xcLy9nLCBcIl9cIik7XG59XG5cbmZ1bmN0aW9uIGJhc2U2NHVybERlY29kZShpbnB1dDogc3RyaW5nKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBTdHJpbmcoaW5wdXQgfHwgXCJcIikucmVwbGFjZSgvLS9nLCBcIitcIikucmVwbGFjZSgvXy9nLCBcIi9cIik7XG4gIGNvbnN0IHBhZGRlZCA9IG5vcm1hbGl6ZWQgKyBcIj1cIi5yZXBlYXQoKDQgLSAobm9ybWFsaXplZC5sZW5ndGggJSA0IHx8IDQpKSAlIDQpO1xuICByZXR1cm4gQnVmZmVyLmZyb20ocGFkZGVkLCBcImJhc2U2NFwiKTtcbn1cblxuZnVuY3Rpb24gaG1hY1NoYTI1NihzZWNyZXQ6IHN0cmluZywgcGF5bG9hZDogc3RyaW5nKSB7XG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSG1hYyhcInNoYTI1NlwiLCBzZWNyZXQpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCb29sKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCkgPT09IFwidHJ1ZVwiO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsbG93bGlzdCh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlSHR0cEVycm9yKHN0YXR1czogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpIHtcbiAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IobWVzc2FnZSkgYXMgRXJyb3IgJiB7IHN0YXR1c0NvZGU/OiBudW1iZXIgfTtcbiAgZXJyb3Iuc3RhdHVzQ29kZSA9IHN0YXR1cztcbiAgcmV0dXJuIGVycm9yO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29udHJhY3Rvckpzb24oc3RhdHVzOiBudW1iZXIsIGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBleHRyYUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGJvZHkpLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tc3RvcmVcIixcbiAgICAgIC4uLmV4dHJhSGVhZGVycyxcbiAgICB9LFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnRyYWN0b3JFcnJvclJlc3BvbnNlKGVycm9yOiB1bmtub3duLCBmYWxsYmFja01lc3NhZ2U6IHN0cmluZykge1xuICBjb25zdCBtZXNzYWdlID0gU3RyaW5nKChlcnJvciBhcyBhbnkpPy5tZXNzYWdlIHx8IGZhbGxiYWNrTWVzc2FnZSk7XG4gIGNvbnN0IHN0YXR1c0NvZGUgPSBOdW1iZXIoKGVycm9yIGFzIGFueSk/LnN0YXR1c0NvZGUgfHwgNTAwKTtcbiAgcmV0dXJuIGNvbnRyYWN0b3JKc29uKHN0YXR1c0NvZGUsIHsgZXJyb3I6IG1lc3NhZ2UgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTdGF0dXModmFsdWU6IHVua25vd24pIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgYWxsb3dlZCA9IG5ldyBTZXQoW1wibmV3XCIsIFwicmV2aWV3aW5nXCIsIFwiYXBwcm92ZWRcIiwgXCJvbl9ob2xkXCIsIFwicmVqZWN0ZWRcIl0pO1xuICByZXR1cm4gYWxsb3dlZC5oYXMobm9ybWFsaXplZCkgPyBub3JtYWxpemVkIDogXCJyZXZpZXdpbmdcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVRhZ3ModmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wQXJyYXkodmFsdWUsIDIwLCA0OCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaWduQ29udHJhY3RvckFkbWluSnd0KFxuICBwYXlsb2FkOiBQaWNrPEFkbWluQ2xhaW1zLCBcInJvbGVcIiB8IFwic3ViXCIgfCBcIm1vZGVcIj4sXG4gIHNlY3JldDogc3RyaW5nLFxuICBleHBpcmVzSW5TZWNvbmRzID0gNjAgKiA2MCAqIDEyXG4pIHtcbiAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gIGNvbnN0IGhlYWRlciA9IGJhc2U2NHVybEVuY29kZShKU09OLnN0cmluZ2lmeSh7IGFsZzogXCJIUzI1NlwiLCB0eXA6IFwiSldUXCIgfSkpO1xuICBjb25zdCBjbGFpbXM6IEFkbWluQ2xhaW1zID0ge1xuICAgIC4uLnBheWxvYWQsXG4gICAgaWF0OiBub3csXG4gICAgZXhwOiBub3cgKyBleHBpcmVzSW5TZWNvbmRzLFxuICB9O1xuICBjb25zdCBib2R5ID0gYmFzZTY0dXJsRW5jb2RlKEpTT04uc3RyaW5naWZ5KGNsYWltcykpO1xuICBjb25zdCBtZXNzYWdlID0gYCR7aGVhZGVyfS4ke2JvZHl9YDtcbiAgY29uc3Qgc2lnbmF0dXJlID0gYmFzZTY0dXJsRW5jb2RlKGhtYWNTaGEyNTYoc2VjcmV0LCBtZXNzYWdlKSk7XG4gIHJldHVybiBgJHttZXNzYWdlfS4ke3NpZ25hdHVyZX1gO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5Q29udHJhY3RvckFkbWluSnd0KHRva2VuOiBzdHJpbmcsIHNlY3JldDogc3RyaW5nKSB7XG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKHRva2VuIHx8IFwiXCIpLnNwbGl0KFwiLlwiKTtcbiAgaWYgKHBhcnRzLmxlbmd0aCAhPT0gMyB8fCAhc2VjcmV0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgW2hlYWRlciwgYm9keSwgc2lnbmF0dXJlXSA9IHBhcnRzO1xuICBjb25zdCBtZXNzYWdlID0gYCR7aGVhZGVyfS4ke2JvZHl9YDtcbiAgY29uc3QgZXhwZWN0ZWQgPSBiYXNlNjR1cmxFbmNvZGUoaG1hY1NoYTI1NihzZWNyZXQsIG1lc3NhZ2UpKTtcbiAgY29uc3QgYWN0dWFsID0gU3RyaW5nKHNpZ25hdHVyZSB8fCBcIlwiKTtcbiAgaWYgKCFleHBlY3RlZCB8fCBleHBlY3RlZC5sZW5ndGggIT09IGFjdHVhbC5sZW5ndGgpIHJldHVybiBudWxsO1xuICBpZiAoIWNyeXB0by50aW1pbmdTYWZlRXF1YWwoQnVmZmVyLmZyb20oZXhwZWN0ZWQpLCBCdWZmZXIuZnJvbShhY3R1YWwpKSkgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3QgY2xhaW1zID0gSlNPTi5wYXJzZShiYXNlNjR1cmxEZWNvZGUoYm9keSkudG9TdHJpbmcoXCJ1dGYtOFwiKSkgYXMgQWRtaW5DbGFpbXM7XG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XG4gICAgaWYgKGNsYWltcy5leHAgJiYgbm93ID4gY2xhaW1zLmV4cCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKGNsYWltcy5yb2xlICE9PSBcImFkbWluXCIpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBjbGFpbXM7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1aXJlQ29udHJhY3RvckFkbWluKHJlcXVlc3Q6IFJlcXVlc3QsIGNvbnRleHQ/OiBhbnkpOiBQcm9taXNlPEFkbWluUHJpbmNpcGFsPiB7XG4gIGNvbnN0IGF1dGggPSByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiYXV0aG9yaXphdGlvblwiKSB8fCByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiQXV0aG9yaXphdGlvblwiKSB8fCBcIlwiO1xuICBjb25zdCBiZWFyZXIgPSBhdXRoLnN0YXJ0c1dpdGgoXCJCZWFyZXIgXCIpID8gYXV0aC5zbGljZShcIkJlYXJlciBcIi5sZW5ndGgpLnRyaW0oKSA6IFwiXCI7XG4gIGNvbnN0IHNlY3JldCA9IFN0cmluZyhwcm9jZXNzLmVudi5BRE1JTl9KV1RfU0VDUkVUIHx8IFwiXCIpLnRyaW0oKTtcblxuICBpZiAoYmVhcmVyICYmIHNlY3JldCkge1xuICAgIGNvbnN0IGNsYWltcyA9IGF3YWl0IHZlcmlmeUNvbnRyYWN0b3JBZG1pbkp3dChiZWFyZXIsIHNlY3JldCk7XG4gICAgaWYgKGNsYWltcz8ucm9sZSA9PT0gXCJhZG1pblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3RvcjogY2xhaW1zLnN1YiB8fCBcImNvbnRyYWN0b3ItYWRtaW5cIixcbiAgICAgICAgbW9kZTogY2xhaW1zLm1vZGUgPT09IFwiaWRlbnRpdHlcIiA/IFwiaWRlbnRpdHlcIiA6IFwicGFzc3dvcmRcIixcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaWRlbnRpdHlVc2VyID0gY29udGV4dD8uY2xpZW50Q29udGV4dD8udXNlcjtcbiAgaWYgKGlkZW50aXR5VXNlcikge1xuICAgIGNvbnN0IGFsbG93QW55b25lID0gcGFyc2VCb29sKHByb2Nlc3MuZW52LkFETUlOX0lERU5USVRZX0FOWU9ORSk7XG4gICAgY29uc3QgYWxsb3dsaXN0ID0gcGFyc2VBbGxvd2xpc3QocHJvY2Vzcy5lbnYuQURNSU5fRU1BSUxfQUxMT1dMSVNUKTtcbiAgICBjb25zdCBlbWFpbCA9IGNsYW1wU3RyaW5nKGlkZW50aXR5VXNlci5lbWFpbCwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChhbGxvd0FueW9uZSB8fCAoZW1haWwgJiYgYWxsb3dsaXN0LmluY2x1ZGVzKGVtYWlsKSkpIHtcbiAgICAgIHJldHVybiB7IGFjdG9yOiBlbWFpbCB8fCBcImlkZW50aXR5LXVzZXJcIiwgbW9kZTogXCJpZGVudGl0eVwiIH07XG4gICAgfVxuICAgIHRocm93IGNyZWF0ZUh0dHBFcnJvcig0MDMsIFwiSWRlbnRpdHkgdXNlciBub3QgYWxsb3dsaXN0ZWQuXCIpO1xuICB9XG5cbiAgdGhyb3cgY3JlYXRlSHR0cEVycm9yKDQwMSwgXCJNaXNzaW5nIG9yIGludmFsaWQgYWRtaW4gYXV0aG9yaXphdGlvbi5cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29udHJhY3RvclF1ZXJ5TGltaXQocmF3OiBzdHJpbmcgfCBudWxsLCBmYWxsYmFjayA9IDEwMCwgbWF4ID0gMjAwKSB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlcihyYXcgfHwgZmFsbGJhY2spO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gZmFsbGJhY2s7XG4gIHJldHVybiBNYXRoLm1heCgxLCBNYXRoLm1pbihtYXgsIE1hdGgudHJ1bmMocGFyc2VkKSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplQ29udHJhY3RvckxhbmVzKHJhdzogdW5rbm93bikge1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gcmF3Lm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0gfHwgXCJcIikudHJpbSgpKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQubWFwKChpdGVtKSA9PiBTdHJpbmcoaXRlbSB8fCBcIlwiKS50cmltKCkpLmZpbHRlcihCb29sZWFuKSA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW10gYXMgc3RyaW5nW107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDb250cmFjdG9yVGFncyhyYXc6IHVua25vd24pIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhdy5tYXAoKGl0ZW0pID0+IFN0cmluZyhpdGVtIHx8IFwiXCIpLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgfVxuICByZXR1cm4gW10gYXMgc3RyaW5nW107XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckFkbWluU2NvcGUoKSB7XG4gIHJldHVybiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29udHJhY3RvckhlYWx0aFByb2JlKCkge1xuICBhd2FpdCBxKFwic2VsZWN0IDEgYXMgb25lXCIsIFtdKTtcbn1cbiIsICJpbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuaW1wb3J0IHsgb3B0IH0gZnJvbSBcIi4vZW52XCI7XG5cbmV4cG9ydCB0eXBlIENvbnRyYWN0b3JJbnRha2VUYXJnZXQgPSB7XG4gIG9yZ0lkOiBzdHJpbmc7XG4gIHdzSWQ6IHN0cmluZyB8IG51bGw7XG4gIG1pc3Npb25JZDogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmNvbnN0IFVVSURfUkUgPSAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVsxLTVdWzAtOWEtZl17M30tWzg5YWJdWzAtOWEtZl17M30tWzAtOWEtZl17MTJ9JC9pO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBBcnJheShpbnB1dDogdW5rbm93biwgbGltaXQ6IG51bWJlciwgbWF4TGVuZ3RoOiBudW1iZXIpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGlucHV0KSkgcmV0dXJuIFtdIGFzIHN0cmluZ1tdO1xuICByZXR1cm4gaW5wdXRcbiAgICAubWFwKChpdGVtKSA9PiBjbGFtcFN0cmluZyhpdGVtLCBtYXhMZW5ndGgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAuc2xpY2UoMCwgbGltaXQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZUVtYWlsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjU0KS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIW5leHQgfHwgIW5leHQuaW5jbHVkZXMoXCJAXCIpIHx8IG5leHQuaW5jbHVkZXMoXCIgXCIpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlUGhvbmUodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGNsYW1wU3RyaW5nKHZhbHVlLCA0MCkucmVwbGFjZSgvW15cXGQrXFwtKCkgXS9nLCBcIlwiKS5zbGljZSgwLCA0MCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXJsKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgNTAwKTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gXCJcIjtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG5leHQpO1xuICAgIGlmIChwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cDpcIiAmJiBwYXJzZWQucHJvdG9jb2wgIT09IFwiaHR0cHM6XCIpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSnNvbkxpc3QodmFsdWU6IHVua25vd24sIGxpbWl0OiBudW1iZXIpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gY2xhbXBBcnJheSh2YWx1ZSwgbGltaXQsIDgwKTtcbiAgY29uc3QgcmF3ID0gU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXSBhcyBzdHJpbmdbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgcmV0dXJuIGNsYW1wQXJyYXkocGFyc2VkLCBsaW1pdCwgODApO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW10gYXMgc3RyaW5nW107XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVGaWxlbmFtZSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDE4MCkgfHwgXCJmaWxlXCI7XG4gIHJldHVybiBuZXh0LnJlcGxhY2UoL1teYS16QS1aMC05Ll8tXS9nLCBcIl9cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1V1aWRMaWtlKHZhbHVlOiB1bmtub3duKSB7XG4gIHJldHVybiBVVUlEX1JFLnRlc3QoU3RyaW5nKHZhbHVlIHx8IFwiXCIpLnRyaW0oKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ29ycmVsYXRpb25JZEZyb21IZWFkZXJzKGhlYWRlcnM6IEhlYWRlcnMpIHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBoZWFkZXJzLmdldChcIngtY29ycmVsYXRpb24taWRcIiksXG4gICAgaGVhZGVycy5nZXQoXCJYLUNvcnJlbGF0aW9uLUlkXCIpLFxuICAgIGhlYWRlcnMuZ2V0KFwieF9jb3JyZWxhdGlvbl9pZFwiKSxcbiAgXTtcbiAgY29uc3QgdmFsdWUgPSBjbGFtcFN0cmluZyhjYW5kaWRhdGVzLmZpbmQoQm9vbGVhbiksIDEyOCk7XG4gIGlmICghdmFsdWUpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvW15hLXpBLVowLTk6X1xcLS5dL2csIFwiXCIpLnNsaWNlKDAsIDEyOCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ29udHJhY3RvckludGFrZVRhcmdldCgpIHtcbiAgY29uc3Qgb3JnSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfT1JHX0lEXCIpLCA2NCk7XG4gIGNvbnN0IHdzSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfV1NfSURcIiksIDY0KSB8fCBudWxsO1xuICBjb25zdCBtaXNzaW9uSWQgPSBjbGFtcFN0cmluZyhvcHQoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRFwiKSwgNjQpIHx8IG51bGw7XG5cbiAgaWYgKCFvcmdJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3IgTmV0d29yayBpbnRha2UgaXMgbm90IGNvbmZpZ3VyZWQuIE1pc3NpbmcgQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gIH1cblxuICBpZiAoIWlzVXVpZExpa2Uob3JnSWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRCBtdXN0IGJlIGEgVVVJRC5cIik7XG4gIH1cblxuICBpZiAod3NJZCkge1xuICAgIGlmICghaXNVdWlkTGlrZSh3c0lkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3Qgd3MgPSBhd2FpdCBxKFwic2VsZWN0IGlkIGZyb20gd29ya3NwYWNlcyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIiwgW3dzSWQsIG9yZ0lkXSk7XG4gICAgaWYgKCF3cy5yb3dzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ09OVFJBQ1RPUl9ORVRXT1JLX1dTX0lEIGRvZXMgbm90IGJlbG9uZyB0byBDT05UUkFDVE9SX05FVFdPUktfT1JHX0lELlwiKTtcbiAgICB9XG4gIH1cblxuICBpZiAobWlzc2lvbklkKSB7XG4gICAgaWYgKCFpc1V1aWRMaWtlKG1pc3Npb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNPTlRSQUNUT1JfTkVUV09SS19NSVNTSU9OX0lEIG11c3QgYmUgYSBVVUlELlwiKTtcbiAgICB9XG4gICAgY29uc3QgbWlzc2lvbiA9IGF3YWl0IHEoXG4gICAgICBcInNlbGVjdCBpZCwgd3NfaWQgZnJvbSBtaXNzaW9ucyB3aGVyZSBpZD0kMSBhbmQgb3JnX2lkPSQyIGxpbWl0IDFcIixcbiAgICAgIFttaXNzaW9uSWQsIG9yZ0lkXVxuICAgICk7XG4gICAgaWYgKCFtaXNzaW9uLnJvd3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDT05UUkFDVE9SX05FVFdPUktfTUlTU0lPTl9JRCBkb2VzIG5vdCBiZWxvbmcgdG8gQ09OVFJBQ1RPUl9ORVRXT1JLX09SR19JRC5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBvcmdJZCxcbiAgICAgIHdzSWQ6IHdzSWQgfHwgbWlzc2lvbi5yb3dzWzBdPy53c19pZCB8fCBudWxsLFxuICAgICAgbWlzc2lvbklkLFxuICAgIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG4gIH1cblxuICByZXR1cm4geyBvcmdJZCwgd3NJZCwgbWlzc2lvbklkOiBudWxsIH0gc2F0aXNmaWVzIENvbnRyYWN0b3JJbnRha2VUYXJnZXQ7XG59XG4iLCAiaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBxIH0gZnJvbSBcIi4vbmVvblwiO1xuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBTdHJpbmcodmFsdWU6IHVua25vd24sIG1heExlbmd0aDogbnVtYmVyKSB7XG4gIGNvbnN0IG5leHQgPSBTdHJpbmcodmFsdWUgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoIW5leHQpIHJldHVybiBcIlwiO1xuICByZXR1cm4gbmV4dC5sZW5ndGggPiBtYXhMZW5ndGggPyBuZXh0LnNsaWNlKDAsIG1heExlbmd0aCkgOiBuZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBNb25leSh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUgfHwgMCk7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiAwO1xuICByZXR1cm4gTWF0aC5yb3VuZChwYXJzZWQgKiAxMDApIC8gMTAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZVVybCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDUwMCk7XG4gIGlmICghbmV4dCkgcmV0dXJuIFwiXCI7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChuZXh0KTtcbiAgICBpZiAoIVtcImh0dHA6XCIsIFwiaHR0cHM6XCJdLmluY2x1ZGVzKHBhcnNlZC5wcm90b2NvbCkpIHJldHVybiBcIlwiO1xuICAgIHJldHVybiBwYXJzZWQudG9TdHJpbmcoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVEYXRlKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IG5leHQgPSBjbGFtcFN0cmluZyh2YWx1ZSwgMjApO1xuICBpZiAoIS9eXFxkezR9LVxcZHsyfS1cXGR7Mn0kLy50ZXN0KG5leHQpKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYWZlVXVpZCh2YWx1ZTogdW5rbm93bikge1xuICBjb25zdCBuZXh0ID0gY2xhbXBTdHJpbmcodmFsdWUsIDY0KTtcbiAgcmV0dXJuIC9eWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzEtNV1bMC05YS1mXXszfS1bODlhYl1bMC05YS1mXXszfS1bMC05YS1mXXsxMn0kL2kudGVzdChuZXh0KSA/IG5leHQgOiBcIlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3N2RXNjYXBlKHZhbHVlOiB1bmtub3duKSB7XG4gIGNvbnN0IHJhdyA9IFN0cmluZyh2YWx1ZSA/PyBcIlwiKTtcbiAgY29uc3QgZXNjYXBlZCA9IHJhdy5yZXBsYWNlKC9cIi9nLCAnXCJcIicpO1xuICByZXR1cm4gL1tcIixcXG5dLy50ZXN0KHJhdykgPyBgXCIke2VzY2FwZWR9XCJgIDogZXNjYXBlZDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnRyYWN0b3JIZWFkZXIoY29udHJhY3RvcklkOiBzdHJpbmcsIG9yZ0lkOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcShcbiAgICBgc2VsZWN0IGlkLCBvcmdfaWQsIHdzX2lkLCBtaXNzaW9uX2lkLCBmdWxsX25hbWUsIGJ1c2luZXNzX25hbWUsIGVtYWlsLCBwaG9uZSwgZW50aXR5X3R5cGUsIHN0YXR1cywgdmVyaWZpZWRcbiAgICAgICBmcm9tIGNvbnRyYWN0b3Jfc3VibWlzc2lvbnNcbiAgICAgIHdoZXJlIGlkPSQxXG4gICAgICAgIGFuZCBvcmdfaWQ9JDJcbiAgICAgIGxpbWl0IDFgLFxuICAgIFtjb250cmFjdG9ySWQsIG9yZ0lkXVxuICApO1xuICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFZlcmlmaWNhdGlvblBhY2tldChjb250cmFjdG9ySWQ6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcShcbiAgICBgc2VsZWN0ICpcbiAgICAgICBmcm9tIGNvbnRyYWN0b3JfdmVyaWZpY2F0aW9uX3BhY2tldHNcbiAgICAgIHdoZXJlIGNvbnRyYWN0b3Jfc3VibWlzc2lvbl9pZD0kMVxuICAgICAgICBhbmQgcGVyaW9kX3N0YXJ0PSQyXG4gICAgICAgIGFuZCBwZXJpb2RfZW5kPSQzXG4gICAgICBsaW1pdCAxYCxcbiAgICBbY29udHJhY3RvcklkLCBzdGFydCwgZW5kXVxuICApO1xuICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFN1bW1hcnlCdW5kbGUoY29udHJhY3RvcklkOiBzdHJpbmcsIG9yZ0lkOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKSB7XG4gIGNvbnN0IGNvbnRyYWN0b3IgPSBhd2FpdCBnZXRDb250cmFjdG9ySGVhZGVyKGNvbnRyYWN0b3JJZCwgb3JnSWQpO1xuICBpZiAoIWNvbnRyYWN0b3IpIHRocm93IG5ldyBFcnJvcihcIkNvbnRyYWN0b3Igbm90IGZvdW5kLlwiKTtcblxuICBjb25zdCBpbmNvbWUgPSBhd2FpdCBxKFxuICAgIGBzZWxlY3QgKlxuICAgICAgIGZyb20gY29udHJhY3Rvcl9pbmNvbWVfZW50cmllc1xuICAgICAgd2hlcmUgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkPSQxXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlID49ICQyXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlIDw9ICQzXG4gICAgICBvcmRlciBieSBlbnRyeV9kYXRlIGRlc2MsIGNyZWF0ZWRfYXQgZGVzY2AsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcblxuICBjb25zdCBleHBlbnNlcyA9IGF3YWl0IHEoXG4gICAgYHNlbGVjdCAqXG4gICAgICAgZnJvbSBjb250cmFjdG9yX2V4cGVuc2VfZW50cmllc1xuICAgICAgd2hlcmUgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkPSQxXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlID49ICQyXG4gICAgICAgIGFuZCBlbnRyeV9kYXRlIDw9ICQzXG4gICAgICBvcmRlciBieSBlbnRyeV9kYXRlIGRlc2MsIGNyZWF0ZWRfYXQgZGVzY2AsXG4gICAgW2NvbnRyYWN0b3JJZCwgc3RhcnQsIGVuZF1cbiAgKTtcblxuICBjb25zdCBwYWNrZXQgPSBhd2FpdCBnZXRWZXJpZmljYXRpb25QYWNrZXQoY29udHJhY3RvcklkLCBzdGFydCwgZW5kKTtcbiAgY29uc3QgdG90YWxzID0ge1xuICAgIGdyb3NzX2luY29tZTogMCxcbiAgICBmZWVzOiAwLFxuICAgIG5ldF9pbmNvbWU6IDAsXG4gICAgZXhwZW5zZXM6IDAsXG4gICAgZGVkdWN0aWJsZV9leHBlbnNlczogMCxcbiAgICBuZXRfYWZ0ZXJfZXhwZW5zZXM6IDAsXG4gIH07XG5cbiAgZm9yIChjb25zdCByb3cgb2YgaW5jb21lLnJvd3MpIHtcbiAgICB0b3RhbHMuZ3Jvc3NfaW5jb21lICs9IE51bWJlcihyb3cuZ3Jvc3NfYW1vdW50IHx8IDApO1xuICAgIHRvdGFscy5mZWVzICs9IE51bWJlcihyb3cuZmVlX2Ftb3VudCB8fCAwKTtcbiAgICB0b3RhbHMubmV0X2luY29tZSArPSBOdW1iZXIocm93Lm5ldF9hbW91bnQgfHwgMCk7XG4gIH1cblxuICBmb3IgKGNvbnN0IHJvdyBvZiBleHBlbnNlcy5yb3dzKSB7XG4gICAgY29uc3QgYW1vdW50ID0gTnVtYmVyKHJvdy5hbW91bnQgfHwgMCk7XG4gICAgY29uc3QgZGVkdWN0aWJsZVBlcmNlbnQgPSBOdW1iZXIocm93LmRlZHVjdGlibGVfcGVyY2VudCB8fCAwKSAvIDEwMDtcbiAgICB0b3RhbHMuZXhwZW5zZXMgKz0gYW1vdW50O1xuICAgIHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzICs9IGFtb3VudCAqIGRlZHVjdGlibGVQZXJjZW50O1xuICB9XG5cbiAgdG90YWxzLmdyb3NzX2luY29tZSA9IGNsYW1wTW9uZXkodG90YWxzLmdyb3NzX2luY29tZSk7XG4gIHRvdGFscy5mZWVzID0gY2xhbXBNb25leSh0b3RhbHMuZmVlcyk7XG4gIHRvdGFscy5uZXRfaW5jb21lID0gY2xhbXBNb25leSh0b3RhbHMubmV0X2luY29tZSk7XG4gIHRvdGFscy5leHBlbnNlcyA9IGNsYW1wTW9uZXkodG90YWxzLmV4cGVuc2VzKTtcbiAgdG90YWxzLmRlZHVjdGlibGVfZXhwZW5zZXMgPSBjbGFtcE1vbmV5KHRvdGFscy5kZWR1Y3RpYmxlX2V4cGVuc2VzKTtcbiAgdG90YWxzLm5ldF9hZnRlcl9leHBlbnNlcyA9IGNsYW1wTW9uZXkodG90YWxzLm5ldF9pbmNvbWUgLSB0b3RhbHMuZXhwZW5zZXMpO1xuXG4gIGNvbnN0IGRpZ2VzdCA9IGNyeXB0b1xuICAgIC5jcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgLnVwZGF0ZShcbiAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY29udHJhY3Rvcl9pZDogY29udHJhY3RvcklkLFxuICAgICAgICBvcmdfaWQ6IG9yZ0lkLFxuICAgICAgICBzdGFydCxcbiAgICAgICAgZW5kLFxuICAgICAgICB0b3RhbHMsXG4gICAgICAgIGluY29tZV9jb3VudDogaW5jb21lLnJvd3MubGVuZ3RoLFxuICAgICAgICBleHBlbnNlX2NvdW50OiBleHBlbnNlcy5yb3dzLmxlbmd0aCxcbiAgICAgIH0pXG4gICAgKVxuICAgIC5kaWdlc3QoXCJoZXhcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250cmFjdG9yLFxuICAgIHBhY2tldCxcbiAgICBpbmNvbWU6IGluY29tZS5yb3dzLFxuICAgIGV4cGVuc2VzOiBleHBlbnNlcy5yb3dzLFxuICAgIHRvdGFscyxcbiAgICBkaWdlc3QsXG4gICAgcGVyaW9kOiB7IHN0YXJ0LCBlbmQgfSxcbiAgfTtcbn0iLCAiaW1wb3J0IHsgYXVkaXQgfSBmcm9tIFwiLi9fc2hhcmVkL2F1ZGl0XCI7XG5pbXBvcnQge1xuICBjb250cmFjdG9yRXJyb3JSZXNwb25zZSxcbiAgcmVxdWlyZUNvbnRyYWN0b3JBZG1pbixcbiAgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlLFxufSBmcm9tIFwiLi9fc2hhcmVkL2NvbnRyYWN0b3ItYWRtaW5cIjtcbmltcG9ydCB7IGdldFN1bW1hcnlCdW5kbGUsIHNhZmVEYXRlLCBzYWZlVXVpZCB9IGZyb20gXCIuL19zaGFyZWQvY29udHJhY3Rvci1pbmNvbWVcIjtcblxuZnVuY3Rpb24gbW9uZXkodmFsdWU6IHVua25vd24pIHtcbiAgcmV0dXJuIGAkJHtOdW1iZXIodmFsdWUgfHwgMCkudG9Mb2NhbGVTdHJpbmcodW5kZWZpbmVkLCB7IG1pbmltdW1GcmFjdGlvbkRpZ2l0czogMiwgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAyIH0pfWA7XG59XG5cbmZ1bmN0aW9uIGVzYyh2YWx1ZTogdW5rbm93bikge1xuICByZXR1cm4gU3RyaW5nKHZhbHVlID8/IFwiXCIpXG4gICAgLnJlcGxhY2UoLyYvZywgXCImYW1wO1wiKVxuICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxuICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgIC5yZXBsYWNlKC9cXFwiL2csIFwiJnF1b3Q7XCIpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAocmVxdWVzdDogUmVxdWVzdCwgY29udGV4dDogYW55KSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYWRtaW4gPSBhd2FpdCByZXF1aXJlQ29udHJhY3RvckFkbWluKHJlcXVlc3QsIGNvbnRleHQpO1xuICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCAhPT0gXCJHRVRcIikge1xuICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZC5cIiB9KSwgeyBzdGF0dXM6IDQwNSwgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9IH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlID0gYXdhaXQgcmVzb2x2ZUNvbnRyYWN0b3JBZG1pblNjb3BlKCk7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCk7XG4gICAgY29uc3QgY29udHJhY3RvclN1Ym1pc3Npb25JZCA9IHNhZmVVdWlkKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkXCIpKTtcbiAgICBjb25zdCBzdGFydCA9IHNhZmVEYXRlKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic3RhcnRcIikpO1xuICAgIGNvbnN0IGVuZCA9IHNhZmVEYXRlKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZW5kXCIpKTtcblxuICAgIGlmICghY29udHJhY3RvclN1Ym1pc3Npb25JZCkgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIk1pc3NpbmcgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkLlwiIH0pLCB7IHN0YXR1czogNDAwLCBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0gfSk7XG4gICAgaWYgKCFzdGFydCB8fCAhZW5kKSByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiTWlzc2luZyBzdGFydCBvciBlbmQgZGF0ZS5cIiB9KSwgeyBzdGF0dXM6IDQwMCwgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9IH0pO1xuXG4gICAgY29uc3QgYnVuZGxlID0gYXdhaXQgZ2V0U3VtbWFyeUJ1bmRsZShjb250cmFjdG9yU3VibWlzc2lvbklkLCBzY29wZS5vcmdJZCwgc3RhcnQsIGVuZCk7XG4gICAgYXdhaXQgYXVkaXQoYWRtaW4uYWN0b3IsIHNjb3BlLm9yZ0lkLCBidW5kbGUuY29udHJhY3Rvci53c19pZCB8fCBudWxsLCBcImNvbnRyYWN0b3IuZmluYW5jZS5yZXBvcnRcIiwge1xuICAgICAgY29udHJhY3Rvcl9zdWJtaXNzaW9uX2lkOiBjb250cmFjdG9yU3VibWlzc2lvbklkLFxuICAgICAgbWlzc2lvbl9pZDogYnVuZGxlLmNvbnRyYWN0b3IubWlzc2lvbl9pZCB8fCBudWxsLFxuICAgICAgcGVyaW9kX3N0YXJ0OiBzdGFydCxcbiAgICAgIHBlcmlvZF9lbmQ6IGVuZCxcbiAgICAgIGRpZ2VzdDogYnVuZGxlLmRpZ2VzdCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHBhY2tldCA9IGJ1bmRsZS5wYWNrZXQgfHwge1xuICAgICAgc3RhdHVzOiBcImRyYWZ0XCIsXG4gICAgICB2ZXJpZmljYXRpb25fdGllcjogXCJjb21wYW55X3ZlcmlmaWVkXCIsXG4gICAgICBpc3N1ZWRfYnlfbmFtZTogXCJTa3llcyBPdmVyIExvbmRvblwiLFxuICAgICAgaXNzdWVkX2J5X3RpdGxlOiBcIkNoaWVmIEV4ZWN1dGl2ZSBPZmZpY2VyXCIsXG4gICAgICBjb21wYW55X25hbWU6IFwiU2t5ZXMgT3ZlciBMb25kb25cIixcbiAgICAgIGNvbXBhbnlfZW1haWw6IFwiU2t5ZXNPdmVyTG9uZG9uTENAc29sZW50ZXJwcmlzZXMub3JnXCIsXG4gICAgICBjb21wYW55X3Bob25lOiBcIjQ4MDQ2OTU0MTZcIixcbiAgICAgIHN0YXRlbWVudF90ZXh0OiBcIlRoaXMgcmVwb3J0IHN1bW1hcml6ZXMgY29udHJhY3RvciBhY3Rpdml0eSBtYWludGFpbmVkIGluc2lkZSB0aGUgY29tcGFueSBwbGF0Zm9ybSBmb3IgdGhlIHJlcG9ydGluZyB3aW5kb3cgc2hvd24uXCIsXG4gICAgICBwYWNrZXRfaGFzaDogYnVuZGxlLmRpZ2VzdCxcbiAgICB9O1xuXG4gICAgY29uc3QgaW5jb21lUm93cyA9IChidW5kbGUuaW5jb21lIHx8IFtdKVxuICAgICAgLm1hcChcbiAgICAgICAgKHJvdykgPT4gYFxuICAgICAgPHRyPlxuICAgICAgICA8dGQ+JHtlc2Mocm93LmVudHJ5X2RhdGUpfTwvdGQ+XG4gICAgICAgIDx0ZD4ke2VzYyhyb3cuc291cmNlX25hbWUpfTwvdGQ+XG4gICAgICAgIDx0ZD4ke2VzYyhyb3cuY2F0ZWdvcnkgfHwgXCJcIil9PC90ZD5cbiAgICAgICAgPHRkPiR7bW9uZXkocm93Lmdyb3NzX2Ftb3VudCl9PC90ZD5cbiAgICAgICAgPHRkPiR7bW9uZXkocm93LmZlZV9hbW91bnQpfTwvdGQ+XG4gICAgICAgIDx0ZD4ke21vbmV5KHJvdy5uZXRfYW1vdW50KX08L3RkPlxuICAgICAgPC90cj5gXG4gICAgICApXG4gICAgICAuam9pbihcIlwiKTtcblxuICAgIGNvbnN0IGV4cGVuc2VSb3dzID0gKGJ1bmRsZS5leHBlbnNlcyB8fCBbXSlcbiAgICAgIC5tYXAoXG4gICAgICAgIChyb3cpID0+IGBcbiAgICAgIDx0cj5cbiAgICAgICAgPHRkPiR7ZXNjKHJvdy5lbnRyeV9kYXRlKX08L3RkPlxuICAgICAgICA8dGQ+JHtlc2Mocm93LnZlbmRvcl9uYW1lKX08L3RkPlxuICAgICAgICA8dGQ+JHtlc2Mocm93LmNhdGVnb3J5IHx8IFwiXCIpfTwvdGQ+XG4gICAgICAgIDx0ZD4ke21vbmV5KHJvdy5hbW91bnQpfTwvdGQ+XG4gICAgICAgIDx0ZD4ke2VzYyhyb3cuZGVkdWN0aWJsZV9wZXJjZW50KX0lPC90ZD5cbiAgICAgIDwvdHI+YFxuICAgICAgKVxuICAgICAgLmpvaW4oXCJcIik7XG5cbiAgICBjb25zdCBodG1sID0gYDwhZG9jdHlwZSBodG1sPlxuPGh0bWwgbGFuZz1cImVuXCI+XG48aGVhZD5cbiAgPG1ldGEgY2hhcnNldD1cInV0Zi04XCIgLz5cbiAgPG1ldGEgbmFtZT1cInZpZXdwb3J0XCIgY29udGVudD1cIndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xXCIgLz5cbiAgPHRpdGxlPkNvbnRyYWN0b3IgSW5jb21lIFZlcmlmaWNhdGlvbiBQYWNrZXQ8L3RpdGxlPlxuICA8c3R5bGU+XG4gICAgOnJvb3Qge1xuICAgICAgLS1iZzogIzA1MDcwZjtcbiAgICAgIC0tcGFuZWw6IHJnYmEoMjU1LDI1NSwyNTUsLjA1KTtcbiAgICAgIC0tbGluZTogcmdiYSgyNTUsMjU1LDI1NSwuMTQpO1xuICAgICAgLS10ZXh0OiAjZjVmN2ZmO1xuICAgICAgLS1tdXRlZDogI2E5YjJjZjtcbiAgICAgIC0tZ29sZDogI2Y0Yzk1ZDtcbiAgICB9XG4gICAgKiB7IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IH1cbiAgICBib2R5IHtcbiAgICAgIG1hcmdpbjogMDsgcGFkZGluZzogMjhweDsgY29sb3I6IHZhcigtLXRleHQpOyBiYWNrZ3JvdW5kOlxuICAgICAgcmFkaWFsLWdyYWRpZW50KGNpcmNsZSBhdCB0b3AsIHJnYmEoMTM5LDkyLDI0NiwuMjApLCB0cmFuc3BhcmVudCAzMCUpLFxuICAgICAgcmFkaWFsLWdyYWRpZW50KGNpcmNsZSBhdCA4MCUgMTAlLCByZ2JhKDI0NCwyMDEsOTMsLjE2KSwgdHJhbnNwYXJlbnQgMzAlKSxcbiAgICAgIHZhcigtLWJnKTtcbiAgICAgIGZvbnQ6IDE0cHgvMS41IEludGVyLCBBcmlhbCwgc2Fucy1zZXJpZjtcbiAgICB9XG4gICAgLnBhZ2UgeyBtYXgtd2lkdGg6IDExMDBweDsgbWFyZ2luOiAwIGF1dG87IH1cbiAgICAuaGVybywgLnBhbmVsIHsgYmFja2dyb3VuZDogdmFyKC0tcGFuZWwpOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1saW5lKTsgYm9yZGVyLXJhZGl1czogMThweDsgfVxuICAgIC5oZXJvIHsgcGFkZGluZzogMjRweDsgbWFyZ2luLWJvdHRvbTogMThweDsgfVxuICAgIC5oZXJvIGgxIHsgbWFyZ2luOiAwIDAgOHB4OyBmb250LXNpemU6IDI4cHg7IH1cbiAgICAuaGVybyBwLCAubXV0ZWQgeyBjb2xvcjogdmFyKC0tbXV0ZWQpOyB9XG4gICAgLmdyaWQgeyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdCgyLCBtaW5tYXgoMCwgMWZyKSk7IGdhcDogMTZweDsgfVxuICAgIC5wYW5lbCB7IHBhZGRpbmc6IDE4cHg7IH1cbiAgICAua3BpcyB7IGRpc3BsYXk6Z3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoNCwgbWlubWF4KDAsMWZyKSk7IGdhcDogMTJweDsgbWFyZ2luOiAxOHB4IDA7IH1cbiAgICAua3BpIHsgYmFja2dyb3VuZDogcmdiYSgyNTUsMjU1LDI1NSwuMDM1KTsgYm9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTsgYm9yZGVyLXJhZGl1czoxNHB4OyBwYWRkaW5nOiAxNHB4OyB9XG4gICAgLmtwaSAubGFiZWwgeyBjb2xvcjogdmFyKC0tbXV0ZWQpOyBmb250LXNpemU6IDExcHg7IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7IGxldHRlci1zcGFjaW5nOiAuMTRlbTsgfVxuICAgIC5rcGkgLnZhbHVlIHsgbWFyZ2luLXRvcDogNnB4OyBmb250LXNpemU6IDIycHg7IGZvbnQtd2VpZ2h0OiA4MDA7IH1cbiAgICAuc2VjdGlvbi10aXRsZSB7IG1hcmdpbjogMCAwIDEwcHg7IGZvbnQtc2l6ZTogMTZweDsgbGV0dGVyLXNwYWNpbmc6IC4wOGVtOyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyBjb2xvcjogdmFyKC0tZ29sZCk7IH1cbiAgICB0YWJsZSB7IHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyB9XG4gICAgdGgsIHRkIHsgdGV4dC1hbGlnbjogbGVmdDsgcGFkZGluZzogMTBweCA4cHg7IGJvcmRlci1ib3R0b206IDFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4wOCk7IHZlcnRpY2FsLWFsaWduOiB0b3A7IH1cbiAgICB0aCB7IGNvbG9yOiB2YXIoLS1tdXRlZCk7IGZvbnQtc2l6ZTogMTFweDsgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsgbGV0dGVyLXNwYWNpbmc6IC4xMmVtOyB9XG4gICAgLnN0YW1wIHsgZGlzcGxheTppbmxpbmUtYmxvY2s7IHBhZGRpbmc6IDdweCAxMHB4OyBib3JkZXItcmFkaXVzOiA5OTlweDsgYm9yZGVyOiAxcHggc29saWQgcmdiYSgyNDQsMjAxLDkzLC40KTsgY29sb3I6IHZhcigtLWdvbGQpOyB9XG4gICAgLnByaW50YmFyIHsgZGlzcGxheTpmbGV4OyBnYXA6MTJweDsgbWFyZ2luLWJvdHRvbToxNnB4OyB9XG4gICAgYnV0dG9uIHsgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDEzNWRlZywgcmdiYSgyNDQsMjAxLDkzLC4xOCksIHJnYmEoMTM5LDkyLDI0NiwuMTgpKTsgY29sb3I6IHZhcigtLXRleHQpOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1saW5lKTsgYm9yZGVyLXJhZGl1czogMTJweDsgcGFkZGluZzogMTBweCAxNHB4OyBjdXJzb3I6IHBvaW50ZXI7IH1cbiAgICBAbWVkaWEgcHJpbnQge1xuICAgICAgYm9keSB7IGJhY2tncm91bmQ6ICNmZmY7IGNvbG9yOiAjMTExOyBwYWRkaW5nOiAwOyB9XG4gICAgICAuaGVybywgLnBhbmVsLCAua3BpIHsgYmFja2dyb3VuZDogI2ZmZjsgYm9yZGVyLWNvbG9yOiAjY2NjOyB9XG4gICAgICAubXV0ZWQsIHRoIHsgY29sb3I6ICM1NTU7IH1cbiAgICAgIC5wcmludGJhciB7IGRpc3BsYXk6bm9uZTsgfVxuICAgICAgLnNlY3Rpb24tdGl0bGUgeyBjb2xvcjogIzMzMzsgfVxuICAgIH1cbiAgPC9zdHlsZT5cbjwvaGVhZD5cbjxib2R5PlxuICA8ZGl2IGNsYXNzPVwicGFnZVwiPlxuICAgIDxkaXYgY2xhc3M9XCJwcmludGJhclwiPlxuICAgICAgPGJ1dHRvbiBvbmNsaWNrPVwid2luZG93LnByaW50KClcIj5QcmludCAvIFNhdmUgUERGPC9idXR0b24+XG4gICAgPC9kaXY+XG4gICAgPHNlY3Rpb24gY2xhc3M9XCJoZXJvXCI+XG4gICAgICA8aDE+JHtlc2MocGFja2V0LmNvbXBhbnlfbmFtZSl9IC0gQ29udHJhY3RvciBJbmNvbWUgVmVyaWZpY2F0aW9uIFBhY2tldDwvaDE+XG4gICAgICA8cD5SZXBvcnRpbmcgd2luZG93OiAke2VzYyhidW5kbGUucGVyaW9kLnN0YXJ0KX0gdGhyb3VnaCAke2VzYyhidW5kbGUucGVyaW9kLmVuZCl9PC9wPlxuICAgICAgPGRpdiBjbGFzcz1cInN0YW1wXCI+JHtlc2MocGFja2V0LnZlcmlmaWNhdGlvbl90aWVyKX0gLSAke2VzYyhwYWNrZXQuc3RhdHVzKX08L2Rpdj5cbiAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHhcIiBjbGFzcz1cIm11dGVkXCI+UGFja2V0IGhhc2g6ICR7ZXNjKHBhY2tldC5wYWNrZXRfaGFzaCB8fCBidW5kbGUuZGlnZXN0KX08L2Rpdj5cbiAgICA8L3NlY3Rpb24+XG5cbiAgICA8ZGl2IGNsYXNzPVwiZ3JpZFwiPlxuICAgICAgPHNlY3Rpb24gY2xhc3M9XCJwYW5lbFwiPlxuICAgICAgICA8aDIgY2xhc3M9XCJzZWN0aW9uLXRpdGxlXCI+Q29udHJhY3RvciBQcm9maWxlPC9oMj5cbiAgICAgICAgPGRpdj48c3Ryb25nPk5hbWU6PC9zdHJvbmc+ICR7ZXNjKGJ1bmRsZS5jb250cmFjdG9yLmZ1bGxfbmFtZSl9PC9kaXY+XG4gICAgICAgIDxkaXY+PHN0cm9uZz5CdXNpbmVzczo8L3N0cm9uZz4gJHtlc2MoYnVuZGxlLmNvbnRyYWN0b3IuYnVzaW5lc3NfbmFtZSB8fCBcIi1cIil9PC9kaXY+XG4gICAgICAgIDxkaXY+PHN0cm9uZz5FbWFpbDo8L3N0cm9uZz4gJHtlc2MoYnVuZGxlLmNvbnRyYWN0b3IuZW1haWwgfHwgXCItXCIpfTwvZGl2PlxuICAgICAgICA8ZGl2PjxzdHJvbmc+UGhvbmU6PC9zdHJvbmc+ICR7ZXNjKGJ1bmRsZS5jb250cmFjdG9yLnBob25lIHx8IFwiLVwiKX08L2Rpdj5cbiAgICAgICAgPGRpdj48c3Ryb25nPkVudGl0eSBUeXBlOjwvc3Ryb25nPiAke2VzYyhidW5kbGUuY29udHJhY3Rvci5lbnRpdHlfdHlwZSB8fCBcImluZGVwZW5kZW50X2NvbnRyYWN0b3JcIil9PC9kaXY+XG4gICAgICA8L3NlY3Rpb24+XG4gICAgICA8c2VjdGlvbiBjbGFzcz1cInBhbmVsXCI+XG4gICAgICAgIDxoMiBjbGFzcz1cInNlY3Rpb24tdGl0bGVcIj5Jc3N1ZXIgQ29udGFjdDwvaDI+XG4gICAgICAgIDxkaXY+PHN0cm9uZz5Jc3N1ZWQgQnk6PC9zdHJvbmc+ICR7ZXNjKHBhY2tldC5pc3N1ZWRfYnlfbmFtZSl9PC9kaXY+XG4gICAgICAgIDxkaXY+PHN0cm9uZz5UaXRsZTo8L3N0cm9uZz4gJHtlc2MocGFja2V0Lmlzc3VlZF9ieV90aXRsZSl9PC9kaXY+XG4gICAgICAgIDxkaXY+PHN0cm9uZz5Db21wYW55Ojwvc3Ryb25nPiAke2VzYyhwYWNrZXQuY29tcGFueV9uYW1lKX08L2Rpdj5cbiAgICAgICAgPGRpdj48c3Ryb25nPkVtYWlsOjwvc3Ryb25nPiAke2VzYyhwYWNrZXQuY29tcGFueV9lbWFpbCl9PC9kaXY+XG4gICAgICAgIDxkaXY+PHN0cm9uZz5QaG9uZTo8L3N0cm9uZz4gJHtlc2MocGFja2V0LmNvbXBhbnlfcGhvbmUpfTwvZGl2PlxuICAgICAgPC9zZWN0aW9uPlxuICAgIDwvZGl2PlxuXG4gICAgPHNlY3Rpb24gY2xhc3M9XCJrcGlzXCI+XG4gICAgICA8ZGl2IGNsYXNzPVwia3BpXCI+PGRpdiBjbGFzcz1cImxhYmVsXCI+R3Jvc3MgSW5jb21lPC9kaXY+PGRpdiBjbGFzcz1cInZhbHVlXCI+JHttb25leShidW5kbGUudG90YWxzLmdyb3NzX2luY29tZSl9PC9kaXY+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwia3BpXCI+PGRpdiBjbGFzcz1cImxhYmVsXCI+UGxhdGZvcm0gLyBTZXJ2aWNlIEZlZXM8L2Rpdj48ZGl2IGNsYXNzPVwidmFsdWVcIj4ke21vbmV5KGJ1bmRsZS50b3RhbHMuZmVlcyl9PC9kaXY+PC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwia3BpXCI+PGRpdiBjbGFzcz1cImxhYmVsXCI+TmV0IEluY29tZTwvZGl2PjxkaXYgY2xhc3M9XCJ2YWx1ZVwiPiR7bW9uZXkoYnVuZGxlLnRvdGFscy5uZXRfaW5jb21lKX08L2Rpdj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJrcGlcIj48ZGl2IGNsYXNzPVwibGFiZWxcIj5FeHBlbnNlczwvZGl2PjxkaXYgY2xhc3M9XCJ2YWx1ZVwiPiR7bW9uZXkoYnVuZGxlLnRvdGFscy5leHBlbnNlcyl9PC9kaXY+PC9kaXY+XG4gICAgPC9zZWN0aW9uPlxuXG4gICAgPHNlY3Rpb24gY2xhc3M9XCJwYW5lbFwiIHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNnB4XCI+XG4gICAgICA8aDIgY2xhc3M9XCJzZWN0aW9uLXRpdGxlXCI+VmVyaWZpY2F0aW9uIFN0YXRlbWVudDwvaDI+XG4gICAgICA8cD4ke2VzYyhwYWNrZXQuc3RhdGVtZW50X3RleHQpfTwvcD5cbiAgICAgIDxwIGNsYXNzPVwibXV0ZWRcIj5UaGlzIHBhY2tldCBpcyBhIGNvbXBhbnktZ2VuZXJhdGVkIHN1bW1hcnkgYmFzZWQgb24gcmVjb3JkcyBtYWludGFpbmVkIGluc2lkZSB0aGUgY29udHJhY3RvciBuZXR3b3JrIHBsYXRmb3JtIGZvciB0aGUgZGF0ZSB3aW5kb3cgc2hvd24uIEV4dGVybmFsIGluc3RpdHV0aW9ucyBtYXkgcmVxdWVzdCBzdXBwbGVtZW50YWwgc291cmNlIHJlY29yZHMgc3VjaCBhcyBiYW5rIHN0YXRlbWVudHMsIHRheCByZXR1cm5zLCBvciByYXcgcGF5b3V0IGV2aWRlbmNlLjwvcD5cbiAgICA8L3NlY3Rpb24+XG5cbiAgICA8c2VjdGlvbiBjbGFzcz1cInBhbmVsXCIgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHhcIj5cbiAgICAgIDxoMiBjbGFzcz1cInNlY3Rpb24tdGl0bGVcIj5JbmNvbWUgTGVkZ2VyPC9oMj5cbiAgICAgIDx0YWJsZT5cbiAgICAgICAgPHRoZWFkPlxuICAgICAgICAgIDx0cj48dGg+RGF0ZTwvdGg+PHRoPlNvdXJjZTwvdGg+PHRoPkNhdGVnb3J5PC90aD48dGg+R3Jvc3M8L3RoPjx0aD5GZWVzPC90aD48dGg+TmV0PC90aD48L3RyPlxuICAgICAgICA8L3RoZWFkPlxuICAgICAgICA8dGJvZHk+JHtpbmNvbWVSb3dzIHx8ICc8dHI+PHRkIGNvbHNwYW49XCI2XCI+Tm8gaW5jb21lIHJvd3MgaW4gdGhpcyBwZXJpb2QuPC90ZD48L3RyPid9PC90Ym9keT5cbiAgICAgIDwvdGFibGU+XG4gICAgPC9zZWN0aW9uPlxuXG4gICAgPHNlY3Rpb24gY2xhc3M9XCJwYW5lbFwiIHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNnB4XCI+XG4gICAgICA8aDIgY2xhc3M9XCJzZWN0aW9uLXRpdGxlXCI+RXhwZW5zZSBMZWRnZXI8L2gyPlxuICAgICAgPHRhYmxlPlxuICAgICAgICA8dGhlYWQ+XG4gICAgICAgICAgPHRyPjx0aD5EYXRlPC90aD48dGg+VmVuZG9yPC90aD48dGg+Q2F0ZWdvcnk8L3RoPjx0aD5BbW91bnQ8L3RoPjx0aD5EZWR1Y3RpYmxlICU8L3RoPjwvdHI+XG4gICAgICAgIDwvdGhlYWQ+XG4gICAgICAgIDx0Ym9keT4ke2V4cGVuc2VSb3dzIHx8ICc8dHI+PHRkIGNvbHNwYW49XCI1XCI+Tm8gZXhwZW5zZSByb3dzIGluIHRoaXMgcGVyaW9kLjwvdGQ+PC90cj4nfTwvdGJvZHk+XG4gICAgICA8L3RhYmxlPlxuICAgIDwvc2VjdGlvbj5cbiAgPC9kaXY+XG48L2JvZHk+XG48L2h0bWw+YDtcblxuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoaHRtbCwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwidGV4dC9odG1sOyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLXN0b3JlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiBjb250cmFjdG9yRXJyb3JSZXNwb25zZShlcnJvciwgXCJGYWlsZWQgdG8gcmVuZGVyIGNvbnRyYWN0b3IgZmluYW5jaWFsIHJlcG9ydC5cIik7XG4gIH1cbn07Il0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7OztBQU1PLFNBQVMsS0FBSyxNQUFzQjtBQUN6QyxRQUFNLElBQUksUUFBUSxJQUFJLElBQUk7QUFDMUIsTUFBSSxDQUFDLEVBQUcsT0FBTSxJQUFJLE1BQU0sb0JBQW9CLElBQUksRUFBRTtBQUNsRCxTQUFPO0FBQ1Q7QUFFTyxTQUFTLElBQUksTUFBYyxXQUFXLElBQVk7QUFDdkQsU0FBTyxRQUFRLElBQUksSUFBSSxLQUFLO0FBQzlCOzs7QUNaQSxTQUFTLGtCQUFrQixLQUFvRTtBQUM3RixNQUFJLGdCQUFnQixLQUFLLEdBQUcsR0FBRztBQUM3QixXQUFPO0FBQUEsTUFD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
