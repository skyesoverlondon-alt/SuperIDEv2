#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const siteBase = (process.env.SITE_BASE_URL || process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const wsBase = process.env.WS_ID || `contractor-vault-smoke-${Date.now()}`;
const outPath = path.join(root, "artifacts", "contractor-vault-roundtrip-smoke.json");
const contractorPath = "/contractor income verification drop in/APP SURFACE/public/index.html";
const vaultPath = "/SkyeVault-Pro-v4.46/drive/index.html";

function nowIso() {
  return new Date().toISOString();
}

function isIgnorableError(message) {
  const text = String(message || "");
  return text.includes("ServiceWorker script evaluation failed") || text.includes("Failed to register a ServiceWorker");
}

async function seedContractor(page) {
  await page.locator('#incomeQuickForm input[name="date"]').fill('2026-03-13');
  await page.locator('#incomeQuickForm input[name="amount"]').fill('412.25');
  await page.locator('#incomeQuickForm input[name="client"]').fill('Roundtrip Client');
  await page.locator('#incomeQuickForm input[name="source"]').fill('Vault Roundtrip');
  await page.locator('#incomeQuickForm button').click();

  await page.locator('#expenseQuickForm input[name="date"]').fill('2026-03-13');
  await page.locator('#expenseQuickForm input[name="amount"]').fill('91.10');
  await page.locator('#expenseQuickForm input[name="category"]').fill('Fuel');
  await page.locator('#expenseQuickForm input[name="client"]').fill('Roundtrip Client');
  await page.locator('#expenseQuickForm button').click();

  await page.locator('[data-module="evidenceVault"]').click();
  await page.locator('#evidenceForm input[name="title"]').fill('Roundtrip Evidence');
  await page.locator('#evidenceForm input[name="date"]').fill('2026-03-13');
  await page.locator('#evidenceForm select[name="type"]').selectOption('Receipt');
  await page.locator('#evidenceForm input[name="client"]').fill('Roundtrip Client');
  await page.locator('#evidenceForm input[name="ref"]').fill('roundtrip-ref');
  await page.locator('#evidenceForm textarea[name="summary"]').fill('Roundtrip evidence summary');
  await page.locator('#evidenceForm button[type="submit"]').click();
  await page.locator('[data-module="dashboardView"]').click();
}

async function readHeroState(page) {
  return {
    income: ((await page.locator('#heroIncome').textContent()) || '').trim(),
    expense: ((await page.locator('#heroExpense').textContent()) || '').trim(),
    evidence: Number((((await page.locator('#heroEvidence').textContent()) || '0').trim()) || '0'),
    gaps: Number((((await page.locator('#heroGaps').textContent()) || '0').trim()) || '0'),
    workspace: ((await page.locator('#workspaceIdBadge').textContent()) || '').trim(),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const sourceWs = `${wsBase}-source`;
  const receiverWs = `${wsBase}-receiver`;
  const startedAt = nowIso();

  const sourcePage = await context.newPage();
  const vaultPage = await context.newPage();
  const receiverPage = await context.newPage();
  const errors = [];

  for (const page of [sourcePage, vaultPage, receiverPage]) {
    page.on('pageerror', (err) => {
      const message = String(err?.message || err);
      if (!isIgnorableError(message)) errors.push(message);
    });
  }

  try {
    await sourcePage.goto(`${siteBase}${contractorPath}?ws_id=${encodeURIComponent(sourceWs)}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sourcePage.waitForTimeout(900);
    await seedContractor(sourcePage);
    const sourceBeforeStage = await readHeroState(sourcePage);

    const popupPromise = context.waitForEvent('page', { timeout: 2500 }).catch(() => null);
    await sourcePage.locator('#pushVaultBtn').click();
    const popup = await popupPromise;
    if (popup) {
      await popup.close().catch(() => {});
    }

    await vaultPage.goto(`${siteBase}${vaultPath}?ws_id=${encodeURIComponent(sourceWs)}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await vaultPage.waitForTimeout(1200);
    await vaultPage.locator('#superide-import-button').click();
    await vaultPage.waitForFunction(() => document.querySelectorAll('[data-export-superide]').length > 0, null, { timeout: 20000 });

    await receiverPage.goto(`${siteBase}${contractorPath}?ws_id=${encodeURIComponent(receiverWs)}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await receiverPage.waitForTimeout(900);
    const receiverBeforeImport = await readHeroState(receiverPage);

    vaultPage.on('dialog', async (dialog) => {
      await dialog.accept('ContractorVerificationSuite');
    });
    await vaultPage.locator('[data-export-superide]').first().click();

    await receiverPage.waitForFunction(() => {
      const income = document.querySelector('#heroIncome')?.textContent?.trim();
      const evidence = Number(document.querySelector('#heroEvidence')?.textContent?.trim() || '0');
      return income && income !== '$0.00' && evidence >= 1;
    }, null, { timeout: 20000 });

    const receiverAfterImport = await readHeroState(receiverPage);
    const vaultStatus = ((await receiverPage.locator('#vaultStatus').textContent()) || '').trim();
    const exportButtons = await vaultPage.locator('[data-export-superide]').count();
    const ok =
      sourceBeforeStage.income !== '$0.00' &&
      sourceBeforeStage.evidence >= 1 &&
      receiverBeforeImport.income === '$0.00' &&
      receiverBeforeImport.evidence === 0 &&
      receiverAfterImport.income !== '$0.00' &&
      receiverAfterImport.evidence >= 1 &&
      receiverAfterImport.workspace === receiverWs &&
      exportButtons >= 1 &&
      errors.length === 0;

    const payload = {
      generated_at: startedAt,
      site_base: siteBase,
      ws_source: sourceWs,
      ws_receiver: receiverWs,
      ok,
      export_buttons: exportButtons,
      source_before_stage: sourceBeforeStage,
      receiver_before_import: receiverBeforeImport,
      receiver_after_import: receiverAfterImport,
      receiver_vault_status: vaultStatus,
      errors,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`[contractor-vault-roundtrip-smoke] Wrote ${path.relative(root, outPath)}`);

    if (!ok) {
      console.error(`[contractor-vault-roundtrip-smoke] FAIL errors=${errors.join(' | ')}`);
      process.exit(1);
    }

    console.log('[contractor-vault-roundtrip-smoke] PASS');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[contractor-vault-roundtrip-smoke] Fatal: ${String(error?.message || error)}`);
  process.exit(1);
});