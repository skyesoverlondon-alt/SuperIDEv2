#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const handoffMode = process.argv.includes("--handoff");

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function parseSimpleTomlValue(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : "";
}

function parseSimpleTomlBoolean(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*(true|false)`, "m"));
  return match ? match[1] === "true" : null;
}

const checks = [];
let failed = false;

function addCheck(ok, label, detail = "") {
  checks.push({ ok, label, detail });
  if (!ok) failed = true;
}

const netlifyTomlPath = "netlify.toml";
const workerTomlPath = "worker/wrangler.toml";
const schemaPath = "db/schema.sql";
const swPath = "public/sw.js";
const appPath = "src/App.tsx";

addCheck(exists(netlifyTomlPath), "Netlify config exists", netlifyTomlPath);
addCheck(exists(workerTomlPath), "Worker config exists", workerTomlPath);
addCheck(exists(schemaPath), "Canonical schema exists", schemaPath);
addCheck(exists(swPath), "Service worker exists", swPath);
addCheck(exists(appPath), "App shell exists", appPath);

const netlifyToml = exists(netlifyTomlPath) ? read(netlifyTomlPath) : "";
const workerToml = exists(workerTomlPath) ? read(workerTomlPath) : "";
const schemaSql = exists(schemaPath) ? read(schemaPath) : "";
const swJs = exists(swPath) ? read(swPath) : "";
const appTsx = exists(appPath) ? read(appPath) : "";

addCheck(netlifyToml.includes('publish = "dist"'), "Netlify publish dir is dist", "netlify.toml [build].publish");
addCheck(netlifyToml.includes('directory = "netlify/functions"'), "Netlify functions dir is explicit", "netlify.toml [functions].directory");
addCheck(netlifyToml.includes('from = "/api/*"') && netlifyToml.includes('to = "/.netlify/functions/:splat"'), "Netlify API redirect is wired", "/api/* -> /.netlify/functions/:splat");

const workerName = parseSimpleTomlValue(workerToml, "name");
const workerMain = parseSimpleTomlValue(workerToml, "main");
const workersDev = parseSimpleTomlBoolean(workerToml, "workers_dev");
addCheck(Boolean(workerName), "Worker service name is set", workerName || "missing");
addCheck(workerMain === "src/index.ts", "Worker entrypoint is src/index.ts", workerMain || "missing");
addCheck(workersDev === true, "Worker deploy target explicitly enables workers.dev", workersDev === null ? "missing" : String(workersDev));
addCheck(workerToml.includes('binding = "KX_SECRETS_KV"'), "Worker KV binding is present", "KX_SECRETS_KV");
addCheck(workerToml.includes('binding = "KX_EVIDENCE_R2"'), "Worker R2 binding is present", "KX_EVIDENCE_R2");

addCheck(schemaSql.includes("create table if not exists ai_brain_usage_log"), "Schema includes AI usage ledger", "ai_brain_usage_log");
addCheck(schemaSql.includes("create table if not exists password_reset_tokens"), "Schema includes password reset tokens", "password_reset_tokens");

addCheck(swJs.includes('"/recover-account/"') && swJs.includes('"/recover-account/index.html"'), "Service worker precaches recover-account route", "public/sw.js");
addCheck(swJs.includes("isRecoverRoute"), "Service worker has dedicated recovery navigation fallback", "public/sw.js navigate handler");
addCheck(appTsx.includes("setAuthFlowMode(\"reset\")") && appTsx.includes('new URL("/recover-account/"'), "App shell forces reset landings onto recovery route", "src/App.tsx reset query effect");

const cloudflareTokenPresent = Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || process.env.CF_ACCOUNT_ID);
const netlifyTokenPresent = Boolean(process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_SITE_ID);
const localNetlifyStatePresent = exists(".netlify/state.json");

addCheck(cloudflareTokenPresent, "Cloudflare deploy credentials present in env", cloudflareTokenPresent ? "present" : "missing in current shell");
addCheck(netlifyTokenPresent || localNetlifyStatePresent, "Netlify auth or linked site state present", netlifyTokenPresent ? "env present" : localNetlifyStatePresent ? ".netlify/state.json present" : "missing in current shell");

if (handoffMode) {
  console.log("# Runtime Handoff");
  console.log("");
  console.log(`Cloudflare Worker service: ${workerName || "kaixu-superide-runner"}`);
  console.log(`Worker entrypoint: ${workerMain || "src/index.ts"}`);
  console.log(`Netlify functions dir: netlify/functions`);
  console.log(`Netlify publish dir: dist`);
  console.log(`Canonical Neon schema: db/schema.sql`);
  console.log("");
  console.log("Current shell status:");
  console.log(`- Cloudflare env auth: ${cloudflareTokenPresent ? "present" : "missing"}`);
  console.log(`- Netlify env auth/link: ${netlifyTokenPresent || localNetlifyStatePresent ? "present" : "missing"}`);
  console.log("");
  console.log("Do this in order:");
  console.log("1. Neon: apply db/schema.sql to the production database actually pointed to by NEON_DATABASE_URL.");
  console.log(`2. Cloudflare: authenticate Wrangler, then deploy the code Worker service '${workerName || "kaixu-superide-runner"}' from worker/wrangler.toml.`);
  console.log("3. Cloudflare: set Worker secrets RUNNER_SHARED_SECRET, NEON_DATABASE_URL, EVIDENCE_SIGNING_KEY, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_TOKEN_MASTER_KEY, NETLIFY_TOKEN_MASTER_KEY, and backup-brain vars if used.");
  console.log("4. Netlify: ensure NEON_DATABASE_URL, WORKER_RUNNER_URL, RUNNER_SHARED_SECRET, KAIXU_GATEWAY_ENDPOINT, and KAIXU_APP_TOKEN are set on the site.");
  console.log("5. Netlify: trigger a production deploy so the service-worker and reset-flow fixes reach the live site.");
  console.log("6. Browser: hard-refresh once after deploy so the new service worker replaces the cached shell.");
  process.exit(failed ? 1 : 0);
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
}

if (failed) {
  console.error("[runtime-deploy] FAILED: one or more runtime deployment prerequisites are missing in this environment.");
  process.exit(1);
}

console.log("[runtime-deploy] PASS: runtime deployment config looks complete in the repository and current shell.");