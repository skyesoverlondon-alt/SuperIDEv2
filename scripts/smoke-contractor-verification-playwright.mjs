#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const siteBase = (process.env.SITE_BASE_URL || process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const wsId = process.env.WS_ID || "primary-workspace";
const outPath = path.join(root, "artifacts", "contractor-verification-smoke.json");
const directPath = "/contractor income verification drop in/APP SURFACE/public/index.html";

const MODULES = [
  { id: "proofPacketStudio", selectors: ["#packetPreview", "#packetTitle"] },
  { id: "evidenceVault", selectors: ["#evidenceForm", "#evidenceList"] },
  { id: "incomeStabilityScoreboard", selectors: [".cvs-chart-bars", ".cvs-grid-4"] },
  { id: "credentialWallet", selectors: ["#credForm", "#credList"] },
  { id: "disputeDefenseBuilder", selectors: ["#disputeForm", "#disputeList"] },
  { id: "taxBucketPlanner", selectors: [".cvs-grid-4", ".cvs-note"] },
  { id: "clientDependenceRadar", selectors: [".cvs-chart-bars"] },
  { id: "mileageFieldLedger", selectors: ["#tripForm", "#tripList"] },
  { id: "invoiceConfidenceDesk", selectors: ["#invoiceForm", "#invoiceList"] },
  { id: "cashflowCalendar", selectors: [".cvs-calendar"] },
  { id: "receiptRescue", selectors: ["#receiptForm", "#receiptList"] },
  { id: "verificationLetterComposer", selectors: ["#letterPreview", "#letterRecipient"] },
  { id: "contractorOperatingProfile", selectors: ["#profileForm", ".cvs-print-frame"] },
  { id: "leadToContractBoard", selectors: ["#leadForm", "#leadBoard"] },
  { id: "missingProofDetector", selectors: [".cvs-note"] },
];

function isIgnorableError(message) {
  const text = String(message || "");
  return text.includes("ServiceWorker script evaluation failed") || text.includes("Failed to register a ServiceWorker");
}

function nowIso() {
  return new Date().toISOString();
}

async function present(page, selector) {
  return (await page.locator(selector).count()) > 0;
}

async function visible(page, selector) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return false;
  return locator.isVisible().catch(() => false);
}

async function seedData(page) {
  await page.locator('#incomeQuickForm input[name="date"]').fill('2026-03-13');
  await page.locator('#incomeQuickForm input[name="amount"]').fill('412.25');
  await page.locator('#incomeQuickForm input[name="client"]').fill('Smoke Client');
  await page.locator('#incomeQuickForm input[name="source"]').fill('Smoke Income');
  await page.locator('#incomeQuickForm button').click();

  await page.locator('#expenseQuickForm input[name="date"]').fill('2026-03-13');
  await page.locator('#expenseQuickForm input[name="amount"]').fill('91.10');
  await page.locator('#expenseQuickForm input[name="category"]').fill('Fuel');
  await page.locator('#expenseQuickForm input[name="client"]').fill('Smoke Client');
  await page.locator('#expenseQuickForm button').click();

  await page.locator('[data-module="evidenceVault"]').click();
  await page.locator('#evidenceForm input[name="title"]').fill('Smoke Evidence');
  await page.locator('#evidenceForm input[name="date"]').fill('2026-03-13');
  await page.locator('#evidenceForm select[name="type"]').selectOption('Receipt');
  await page.locator('#evidenceForm input[name="client"]').fill('Smoke Client');
  await page.locator('#evidenceForm input[name="ref"]').fill('smoke-ref');
  await page.locator('#evidenceForm textarea[name="summary"]').fill('Smoke evidence summary');
  await page.locator('#evidenceForm button[type="submit"]').click();
  await page.locator('[data-module="dashboardView"]').click();
}

async function verifyPersistence(page) {
  const income = ((await page.locator('#heroIncome').textContent()) || '').trim();
  const expense = ((await page.locator('#heroExpense').textContent()) || '').trim();
  const evidence = ((await page.locator('#heroEvidence').textContent()) || '').trim();
  return {
    income,
    expense,
    evidence,
    ok: income !== '$0.00' && expense !== '$0.00' && Number(evidence || '0') >= 1,
  };
}

async function runDirectSurfaceCheck(browser) {
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => {
    const message = String(err?.message || err);
    if (!isIgnorableError(message)) errors.push(message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const url = `${siteBase}${directPath}?ws_id=${encodeURIComponent(wsId)}`;
  const start = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    const status = response?.status() ?? 0;
    await page.waitForTimeout(900);

    const bodyAppId = await page.getAttribute('body', 'data-app-id');
    const hasRuntimeBar = await present(page, '.cvs-runtime-bar');
    const hasSyncStatus = await present(page, '#syncStatus');
    const hasVaultStatus = await present(page, '#vaultStatus');
    const hasPushVaultBtn = await present(page, '#pushVaultBtn');
    const navCount = await page.locator('.cvs-nav-btn').count();

    await seedData(page);
    const beforeReload = await verifyPersistence(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(900);
    const afterReload = await verifyPersistence(page);

    const moduleResults = {};
    for (const module of MODULES) {
      await page.locator(`[data-module="${module.id}"]`).click();
      await page.waitForTimeout(120);
      moduleResults[module.id] = {
        sectionPresent: await present(page, `#${module.id}.active`),
        selectors: {},
      };
      for (const selector of module.selectors) {
        moduleResults[module.id].selectors[selector] = await present(page, selector) || await visible(page, selector);
      }
    }

    const modulesOk = Object.values(moduleResults).every((entry) => entry.sectionPresent && Object.values(entry.selectors).every(Boolean));
    const ok = status >= 200 && status < 400 && bodyAppId === 'ContractorVerificationSuite' && hasRuntimeBar && hasSyncStatus && hasVaultStatus && hasPushVaultBtn && navCount >= 16 && beforeReload.ok && afterReload.ok && modulesOk && errors.length === 0;

    return {
      kind: 'surface',
      url,
      ok,
      status,
      bodyAppId,
      hasRuntimeBar,
      hasSyncStatus,
      hasVaultStatus,
      hasPushVaultBtn,
      navCount,
      persistence: { beforeReload, afterReload },
      moduleResults,
      errors,
      consoleErrors,
      ms: Date.now() - start,
    };
  } catch (error) {
    return {
      kind: 'surface',
      url,
      ok: false,
      status: 0,
      bodyAppId: null,
      hasRuntimeBar: false,
      hasSyncStatus: false,
      hasVaultStatus: false,
      hasPushVaultBtn: false,
      navCount: 0,
      persistence: null,
      moduleResults: {},
      errors: [String(error?.message || error), ...errors],
      consoleErrors,
      ms: Date.now() - start,
    };
  } finally {
    await page.close();
  }
}

async function runShellEmbeddingCheck(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => {
    const message = String(err?.message || err);
    if (!isIgnorableError(message)) errors.push(message);
  });
  const url = `${siteBase}/index.html?app=${encodeURIComponent('ContractorVerificationSuite')}&ws_id=${encodeURIComponent(wsId)}`;
  const start = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    const status = response?.status() ?? 0;
    await page.waitForTimeout(1200);
    const hasModule = await visible(page, '.app-module');
    const hasFrame = (await page.locator('iframe.platform-frame').count()) > 0 || (await page.locator('iframe.preview-frame').count()) > 0;
    const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').toLowerCase();
    const namesApp = bodyText.includes('contractor verification suite');
    const ok = status >= 200 && status < 400 && hasModule && (hasFrame || namesApp) && errors.length === 0;
    return {
      kind: 'shell',
      url,
      ok,
      status,
      hasModule,
      hasFrame,
      namesApp,
      errors,
      ms: Date.now() - start,
    };
  } catch (error) {
    return {
      kind: 'shell',
      url,
      ok: false,
      status: 0,
      hasModule: false,
      hasFrame: false,
      namesApp: false,
      errors: [String(error?.message || error), ...errors],
      ms: Date.now() - start,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const startedAt = nowIso();
  const surface = await runDirectSurfaceCheck(browser);
  const shell = await runShellEmbeddingCheck(browser);
  await browser.close();

  const failures = [surface, shell].filter((item) => !item.ok);
  const payload = {
    generated_at: startedAt,
    site_base: siteBase,
    ws_id: wsId,
    checks_total: 2,
    checks_failed: failures.length,
    ok: failures.length === 0,
    surface,
    shell,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[contractor-verification-smoke] Wrote ${path.relative(root, outPath)} :: total_checks=2 failed=${failures.length}`);

  if (failures.length) {
    for (const failure of failures) {
      console.error(`[contractor-verification-smoke] FAIL ${failure.kind} status=${failure.status} ms=${failure.ms} errors=${(failure.errors || []).join(' | ')}`);
    }
    process.exit(1);
  }

  console.log('[contractor-verification-smoke] PASS');
}

main().catch((error) => {
  console.error(`[contractor-verification-smoke] Fatal: ${String(error?.message || error)}`);
  process.exit(1);
});