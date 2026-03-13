import crypto from "crypto";
import { q } from "./neon";

export function clampString(value: unknown, maxLength: number) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}

export function clampMoney(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function safeUrl(value: unknown) {
  const next = clampString(value, 500);
  if (!next) return "";
  try {
    const parsed = new URL(next);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function safeDate(value: unknown) {
  const next = clampString(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return "";
  return next;
}

export function safeUuid(value: unknown) {
  const next = clampString(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(next) ? next : "";
}

export function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, '""');
  return /[",\n]/.test(raw) ? `"${escaped}"` : escaped;
}

export async function getContractorHeader(contractorId: string, orgId: string) {
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

export async function getVerificationPacket(contractorId: string, start: string, end: string) {
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

export async function getSummaryBundle(contractorId: string, orgId: string, start: string, end: string) {
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
    net_after_expenses: 0,
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

  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        contractor_id: contractorId,
        org_id: orgId,
        start,
        end,
        totals,
        income_count: income.rows.length,
        expense_count: expenses.rows.length,
      })
    )
    .digest("hex");

  return {
    contractor,
    packet,
    income: income.rows,
    expenses: expenses.rows,
    totals,
    digest,
    period: { start, end },
  };
}