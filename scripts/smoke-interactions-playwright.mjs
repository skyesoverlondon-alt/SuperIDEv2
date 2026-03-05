#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const publicDir = path.join(root, "public");
const siteBase = (process.env.SITE_BASE_URL || process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const wsId = process.env.WS_ID || "primary-workspace";
const outPath = path.join(root, "artifacts", "interaction-smoke.json");

function listAppDirs() {
  if (!fs.existsSync(publicDir)) return [];
  return fs
    .readdirSync(publicDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith("_") && fs.existsSync(path.join(publicDir, name, "index.html")))
    .sort((a, b) => a.localeCompare(b));
}

function nowIso() {
  return new Date().toISOString();
}

async function runSurfaceCheck(browser, app) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err?.message || err)));
  const url = `${siteBase}/${app}/index.html?ws_id=${encodeURIComponent(wsId)}&embed=1`;
  const start = Date.now();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const status = res?.status() ?? 0;
    await page.waitForTimeout(300);

    // Generic interaction probes (safe/no-auth-first)
    if (await page.locator("#title").count()) {
      await page.locator("#title").fill(`${app} smoke title`);
    }
    if (await page.locator("#content").count()) {
      await page.locator("#content").fill("Interaction smoke content draft.");
    }
    if (await page.locator("#seedBtn").count()) {
      await page.locator("#seedBtn").click({ timeout: 3000 });
    }
    if (await page.locator("#btn-preview").count()) {
      await page.locator("#btn-preview").click({ timeout: 3000 });
    }

    const bodyText = await page.evaluate(() => (document.body?.innerText || "").trim());
    const nonBlank = bodyText.length > 40;
    const ok = status >= 200 && status < 400 && nonBlank && errors.length === 0;
    return {
      kind: "surface",
      app,
      url,
      ok,
      status,
      nonBlank,
      bodyChars: bodyText.length,
      errors,
      ms: Date.now() - start,
    };
  } catch (error) {
    return {
      kind: "surface",
      app,
      url,
      ok: false,
      status: 0,
      nonBlank: false,
      bodyChars: 0,
      errors: [String(error?.message || error), ...errors],
      ms: Date.now() - start,
    };
  } finally {
    await page.close();
  }
}

async function runIdeCheck(browser, app) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err?.message || err)));
  const url = `${siteBase}/index.html?app=${encodeURIComponent(app)}&ws_id=${encodeURIComponent(wsId)}`;
  const start = Date.now();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    const status = res?.status() ?? 0;
    await page.waitForTimeout(900);

    const hasModule = (await page.locator(".app-module").count()) > 0;
    const hasPlatformFrame = (await page.locator("iframe.platform-frame").count()) > 0;
    const hasPreviewFrame = (await page.locator("iframe.preview-frame").count()) > 0;
    const activeText = await page.evaluate(() => document.body?.innerText || "");
    const namesApp = activeText.toLowerCase().includes(app.toLowerCase());

    const ok = status >= 200 && status < 400 && hasModule && (hasPlatformFrame || hasPreviewFrame || namesApp) && errors.length === 0;
    return {
      kind: "ide",
      app,
      url,
      ok,
      status,
      hasModule,
      hasPlatformFrame,
      hasPreviewFrame,
      namesApp,
      errors,
      ms: Date.now() - start,
    };
  } catch (error) {
    return {
      kind: "ide",
      app,
      url,
      ok: false,
      status: 0,
      hasModule: false,
      hasPlatformFrame: false,
      hasPreviewFrame: false,
      namesApp: false,
      errors: [String(error?.message || error), ...errors],
      ms: Date.now() - start,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const apps = listAppDirs();
  if (!apps.length) {
    console.error("[interaction-smoke] No app surfaces found under public/*/index.html");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const startedAt = nowIso();
  const surfaceResults = [];
  const ideResults = [];

  for (const app of apps) {
    surfaceResults.push(await runSurfaceCheck(browser, app));
  }
  for (const app of apps) {
    ideResults.push(await runIdeCheck(browser, app));
  }

  await browser.close();

  const all = [...surfaceResults, ...ideResults];
  const failures = all.filter((r) => !r.ok);
  const payload = {
    generated_at: startedAt,
    site_base: siteBase,
    ws_id: wsId,
    app_count: apps.length,
    checks_total: all.length,
    checks_failed: failures.length,
    ok: failures.length === 0,
    surface_results: surfaceResults,
    ide_results: ideResults,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[interaction-smoke] Wrote ${path.relative(root, outPath)} :: apps=${apps.length} total_checks=${all.length} failed=${failures.length}`);

  if (failures.length) {
    for (const f of failures.slice(0, 20)) {
      console.error(`[interaction-smoke] FAIL ${f.kind}:${f.app} status=${f.status} ms=${f.ms} errors=${(f.errors || []).join(" | ")}`);
    }
    process.exit(1);
  }

  console.log("[interaction-smoke] PASS");
}

main().catch((err) => {
  console.error(`[interaction-smoke] Fatal: ${String(err?.message || err)}`);
  process.exit(1);
});
