import crypto from "node:crypto";
import { getSql } from "./neon.mjs";

export function clampString(value, maxLength) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.length > maxLength ? next.slice(0, maxLength) : next;
}

export function clampMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function safeUrl(value) {
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

export function safeDate(value) {
  const next = clampString(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return "";
  return next;
}

export function safeUuid(value) {
  const next = clampString(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(next) ? next : "";
}

export function csvEscape(v){
  const s = String(v ?? "");
  const needs = /[",\n]/.test(s);
  const out = s.replace(/"/g,'""');
  return needs ? `"${out}"` : out;
}

export async function getContractorHeader(sql, contractorId) {
  const rows = await sql`
    SELECT id, full_name, business_name, email, phone, entity_type, status, verified
    FROM contractor_submissions
    WHERE id = ${contractorId}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

export async function getPacket(sql, contractorId, start, end) {
  const rows = await sql`
    SELECT *
    FROM contractor_verification_packets
    WHERE contractor_submission_id = ${contractorId}
      AND period_start = ${start}
      AND period_end = ${end}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

export async function getSummaryBundle(contractorId, start, end) {
  const sql = getSql();
  const contractor = await getContractorHeader(sql, contractorId);
  if (!contractor) throw new Error("Contractor not found");

  const income = await sql`
    SELECT *
    FROM contractor_income_entries
    WHERE contractor_submission_id = ${contractorId}
      AND entry_date >= ${start}
      AND entry_date <= ${end}
    ORDER BY entry_date DESC, created_at DESC
  `;

  const expenses = await sql`
    SELECT *
    FROM contractor_expense_entries
    WHERE contractor_submission_id = ${contractorId}
      AND entry_date >= ${start}
      AND entry_date <= ${end}
    ORDER BY entry_date DESC, created_at DESC
  `;

  const packet = await getPacket(sql, contractorId, start, end);

  const totals = {
    gross_income: 0,
    fees: 0,
    net_income: 0,
    expenses: 0,
    deductible_expenses: 0,
    net_after_expenses: 0,
  };

  for (const row of income || []) {
    totals.gross_income += Number(row.gross_amount || 0);
    totals.fees += Number(row.fee_amount || 0);
    totals.net_income += Number(row.net_amount || 0);
  }

  for (const row of expenses || []) {
    const amount = Number(row.amount || 0);
    const pct = Number(row.deductible_percent || 0) / 100;
    totals.expenses += amount;
    totals.deductible_expenses += amount * pct;
  }

  totals.gross_income = clampMoney(totals.gross_income);
  totals.fees = clampMoney(totals.fees);
  totals.net_income = clampMoney(totals.net_income);
  totals.expenses = clampMoney(totals.expenses);
  totals.deductible_expenses = clampMoney(totals.deductible_expenses);
  totals.net_after_expenses = clampMoney(totals.net_income - totals.expenses);

  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ contractorId, start, end, totals, incomeCount: income.length, expenseCount: expenses.length }))
    .digest("hex");

  return { contractor, packet, income, expenses, totals, digest, period: { start, end } };
}
