#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const siteBase = (process.env.SITE_BASE_URL || process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const wsId = process.env.WS_ID || "primary-workspace";
const outPath = path.join(root, "artifacts", "kaixu-platform-smoke.json");

const SURFACES = [
  { appId: "kAIxUPlatform", label: "kAIxU Platform", path: "/kAIxU/index.html", type: "hub", selectors: [".hero", ".track-grid", ".product-grid"], requiresNavbar: false, requiresProjectInput: false, requiresPlatformFrame: false },
  { appId: "kAIxUSuite", label: "kAIxU Suite", path: "/kAIxUSuite/index.html", type: "hub", selectors: [".hero", ".lane-list", ".group-grid"], requiresNavbar: false, requiresProjectInput: false, requiresPlatformFrame: false },
  { appId: "kAIxU-Vision", label: "Vision", path: "/kAIxU-Vision/index.html", type: "app", selectors: ["#frame-list", "#frame-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAixu-Nexus", label: "Nexus", path: "/kAixu-Nexus/index.html", type: "app", selectors: ["#app", "#log-container"], requiresNavbar: true, requiresProjectInput: false, requiresPlatformFrame: true },
  { appId: "kAIxU-Codex", label: "Codex", path: "/kAIxU-Codex/index.html", type: "app", selectors: ["#entry-list", "#entry-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Atmos", label: "Atmos", path: "/kAIxu-Atmos/index.html", type: "app", selectors: ["#log-list", "#log-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Quest", label: "Quest", path: "/kAIxu-Quest/index.html", type: "app", selectors: ["#quest-list", "#quest-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Forge", label: "Forge", path: "/kAIxu-Forge/index.html", type: "app", selectors: ["#item-list", "#item-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Atlas", label: "Atlas", path: "/kAIxu-Atlas/index.html", type: "app", selectors: ["#location-list", "#location-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAixU-Chronos", label: "Chronos", path: "/kAixU-Chronos/index.html", type: "app", selectors: ["#event-list", "#event-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Bestiary", label: "Bestiary", path: "/kAIxu-Bestiary/index.html", type: "app", selectors: ["#creature-list", "#creature-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Mythos", label: "Mythos", path: "/kAIxu-Mythos/index.html", type: "app", selectors: ["#deity-list", "#deity-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxU-Matrix", label: "Matrix", path: "/kAIxU-Matrix/index.html", type: "app", selectors: ["#node-list", "#node-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxu-Persona", label: "Persona", path: "/kAIxu-Persona/index.html", type: "app", selectors: ["#profile-list", "#persona-bio"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxU-Faction", label: "Faction", path: "/kAIxU-Faction/index.html", type: "app", selectors: ["#faction-list", "#faction-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
  { appId: "kAIxU-PrimeCommand", label: "PrimeCommand", path: "/kAIxU-PrimeCommand/index.html", type: "app", selectors: ["#node-list", "#node-content"], requiresNavbar: true, requiresProjectInput: true, requiresPlatformFrame: true },
];

function isIgnorableError(message) {
  const text = String(message || "");
  return text.includes("ServiceWorker script evaluation failed") || text.includes("Failed to register a ServiceWorker");
}

function nowIso() {
  return new Date().toISOString();
}

async function countVisible(page, selector) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return false;
  return locator.isVisible().catch(() => false);
}

async function countPresent(page, selector) {
  return (await page.locator(selector).count()) > 0;
}

async function runDirectSurfaceCheck(browser, surface) {
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => {
    const message = String(err?.message || err);
    if (!isIgnorableError(message)) errors.push(message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const url = `${siteBase}${surface.path}?ws_id=${encodeURIComponent(wsId)}`;
  const start = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    const status = response?.status() ?? 0;
    await page.waitForTimeout(700);

    const bodyAppId = await page.getAttribute("body", "data-app-id");
    const hasNavbar = surface.requiresNavbar ? await countPresent(page, "#navbar") : true;
    const hasPlatformFrame = surface.requiresPlatformFrame ? await countPresent(page, "#kaixu-platform-frame") : true;
    const hasProjectInput = surface.requiresProjectInput ? await countPresent(page, "#proj-title-input") : true;
    const selectorResults = {};
    for (const selector of surface.selectors) {
      selectorResults[selector] = await countVisible(page, selector);
    }
    const allSelectorsMounted = Object.values(selectorResults).every(Boolean);

    const ok = status >= 200 && status < 400 && hasNavbar && hasPlatformFrame && hasProjectInput && allSelectorsMounted && errors.length === 0;
    return {
      kind: "surface",
      app: surface.appId,
      label: surface.label,
      url,
      ok,
      status,
      bodyAppId,
      hasNavbar,
      hasPlatformFrame,
      hasProjectInput,
      selectorResults,
      errors,
      consoleErrors,
      ms: Date.now() - start,
    };
  } catch (error) {
    return {
      kind: "surface",
      app: surface.appId,
      label: surface.label,
      url,
      ok: false,
      status: 0,
      bodyAppId: null,
      hasNavbar: false,
      hasPlatformFrame: false,
      hasProjectInput: false,
      selectorResults: {},
      errors: [String(error?.message || error), ...errors],
      consoleErrors,
      ms: Date.now() - start,
    };
  } finally {
    await page.close();
  }
}

async function runShellEmbeddingCheck(browser, surface) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => {
    const message = String(err?.message || err);
    if (!isIgnorableError(message)) errors.push(message);
  });
  const url = `${siteBase}/index.html?app=${encodeURIComponent(surface.appId)}&ws_id=${encodeURIComponent(wsId)}`;
  const start = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
    const status = response?.status() ?? 0;
    await page.waitForTimeout(1200);

    const hasModule = await countVisible(page, ".app-module");
    const hasFrame = (await page.locator("iframe.platform-frame").count()) > 0 || (await page.locator("iframe.preview-frame").count()) > 0;
    const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").toLowerCase();
    const namesApp = bodyText.includes(surface.appId.toLowerCase()) || bodyText.includes(surface.label.toLowerCase());
    const ok = status >= 200 && status < 400 && hasModule && (hasFrame || namesApp) && errors.length === 0;

    return {
      kind: "shell",
      app: surface.appId,
      label: surface.label,
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
      kind: "shell",
      app: surface.appId,
      label: surface.label,
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
  const directResults = [];
  const shellResults = [];

  for (const surface of SURFACES) {
    directResults.push(await runDirectSurfaceCheck(browser, surface));
  }
  for (const surface of SURFACES) {
    shellResults.push(await runShellEmbeddingCheck(browser, surface));
  }

  await browser.close();

  const all = [...directResults, ...shellResults];
  const failures = all.filter((result) => !result.ok);
  const payload = {
    generated_at: startedAt,
    site_base: siteBase,
    ws_id: wsId,
    surface_count: SURFACES.length,
    checks_total: all.length,
    checks_failed: failures.length,
    ok: failures.length === 0,
    direct_results: directResults,
    shell_results: shellResults,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[kaixu-platform-smoke] Wrote ${path.relative(root, outPath)} :: surfaces=${SURFACES.length} total_checks=${all.length} failed=${failures.length}`);

  if (failures.length) {
    for (const failure of failures.slice(0, 20)) {
      console.error(`[kaixu-platform-smoke] FAIL ${failure.kind}:${failure.app} status=${failure.status} ms=${failure.ms} errors=${(failure.errors || []).join(" | ")}`);
    }
    process.exit(1);
  }

  console.log("[kaixu-platform-smoke] PASS");
}

main().catch((error) => {
  console.error(`[kaixu-platform-smoke] Fatal: ${String(error?.message || error)}`);
  process.exit(1);
});