import { audit } from "./_shared/audit";
import {
  contractorErrorResponse,
  requireContractorAdmin,
  resolveContractorAdminScope,
} from "./_shared/contractor-admin";
import { getSummaryBundle, safeDate, safeUuid } from "./_shared/contractor-income";

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export default async (request: Request, context: any) => {
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
      digest: bundle.digest,
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
      packet_hash: bundle.digest,
    };

    const incomeRows = (bundle.income || [])
      .map(
        (row) => `
      <tr>
        <td>${esc(row.entry_date)}</td>
        <td>${esc(row.source_name)}</td>
        <td>${esc(row.category || "")}</td>
        <td>${money(row.gross_amount)}</td>
        <td>${money(row.fee_amount)}</td>
        <td>${money(row.net_amount)}</td>
      </tr>`
      )
      .join("");

    const expenseRows = (bundle.expenses || [])
      .map(
        (row) => `
      <tr>
        <td>${esc(row.entry_date)}</td>
        <td>${esc(row.vendor_name)}</td>
        <td>${esc(row.category || "")}</td>
        <td>${money(row.amount)}</td>
        <td>${esc(row.deductible_percent)}%</td>
      </tr>`
      )
      .join("");

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
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractorErrorResponse(error, "Failed to render contractor financial report.");
  }
};