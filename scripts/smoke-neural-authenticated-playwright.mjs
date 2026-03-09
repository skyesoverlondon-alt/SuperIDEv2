#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const siteBase = String(process.env.SITE_BASE_URL || process.env.NEURAL_SITE_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const wsId = String(process.env.NEURAL_WS_ID || process.env.WS_ID || "primary-workspace").trim();
const sessionToken = String(process.env.KX_SESSION || process.env.NEURAL_KX_SESSION || "").trim();
const projectName = `Neural Smoke ${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outPath = path.join(root, "artifacts", "neural-authenticated-smoke.json");

if (!sessionToken) {
  console.error("[neural-authenticated-smoke] Missing KX_SESSION or NEURAL_KX_SESSION.");
  process.exit(2);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForText(locator, pattern, timeout = 20000) {
  await locator.waitFor({ state: "visible", timeout });
  await locator.page().waitForFunction(
    ({ selector, source }) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      return new RegExp(source, "i").test(node.textContent || "");
    },
    { selector: await locator.evaluate((node) => {
      if (node.id) return `#${node.id}`;
      return null;
    }), source: pattern.source },
    { timeout }
  ).catch(() => undefined);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const hostname = new URL(siteBase).hostname;
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "kx_session",
      value: sessionToken,
      domain: hostname,
      path: "/",
      httpOnly: true,
      secure: siteBase.startsWith("https://"),
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.message || error)));
  await page.addInitScript((smokeProjectName) => {
    window.prompt = () => smokeProjectName;
  }, projectName);

  const url = `${siteBase}/Neural-Space-Pro/index.html?ws_id=${encodeURIComponent(wsId)}`;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => undefined);

  const grounding = page.locator("#workspace-grounding-status");
  await grounding.waitFor({ state: "visible", timeout: 20000 });
  const groundingText = await grounding.textContent();
  assert(!/Unavailable|Session required/i.test(groundingText || ""), `Workspace grounding unavailable: ${groundingText}`);

  await page.getByRole("button", { name: /New Project/i }).click();
  await page.waitForFunction((expected) => {
    const select = document.querySelector("#project-select");
    if (!select) return false;
    return Array.from(select.querySelectorAll("option")).some((option) => (option.textContent || "").includes(expected));
  }, projectName, { timeout: 20000 });

  const input = page.locator("#user-input");
  await input.fill("Smoke prompt alpha");
  await input.press("Enter");
  await page.getByRole("button", { name: /^Retry$/ }).first().waitFor({ timeout: 45000 });

  const historyCards = page.locator("#history-list article");
  await historyCards.first().waitFor({ state: "visible", timeout: 20000 });
  const historyCountBeforeReload = await historyCards.count();
  assert(historyCountBeforeReload > 0, "Session history did not render.");

  await page.getByRole("button", { name: /^Edit$/ }).first().click();
  await input.fill("Smoke prompt beta");
  await input.press("Enter");
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll("#messages-list .prose")).some((node) => (node.textContent || "").includes("Smoke prompt beta"));
  }, { timeout: 45000 });

  await page.getByRole("button", { name: /^Retry$/ }).first().click();
  await page.getByRole("button", { name: /^Retry$/ }).first().waitFor({ timeout: 45000 });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => undefined);
  const historyCountAfterReload = await page.locator("#history-list article").count();
  assert(historyCountAfterReload > 0, "Session history disappeared after reload.");

  const payload = {
    ok: true,
    site_base: siteBase,
    ws_id: wsId,
    project_name: projectName,
    status: response?.status() ?? 0,
    grounding: groundingText,
    history_before_reload: historyCountBeforeReload,
    history_after_reload: historyCountAfterReload,
    errors,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));

  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(`[neural-authenticated-smoke] ${error?.message || error}`);
  process.exit(1);
});