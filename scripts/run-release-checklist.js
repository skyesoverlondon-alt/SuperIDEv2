#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts");
const outFile = path.join(outDir, "release-checklist.json");

const checks = [
  { id: "gateway_only", cmd: ["npm", ["run", "check:gateway-only"]], blocking: true, area: "security", contract: "gateway-only policy" },
  { id: "external_endpoints", cmd: ["npm", ["run", "check:external-endpoints"]], blocking: true, area: "security", contract: "external endpoint policy" },
  { id: "provider_strings", cmd: ["npm", ["run", "check:provider-strings"]], blocking: true, area: "security", contract: "provider string policy" },
  { id: "secure_defaults", cmd: ["npm", ["run", "check:secure-defaults"]], blocking: true, area: "security", contract: "secure defaults" },
  { id: "protected_apps", cmd: ["npm", ["run", "check:protected-apps"]], blocking: true, area: "security", contract: "protected app integrity" },
  { id: "skye_schema", cmd: ["npm", ["run", "check:skye-schema"]], blocking: true, area: "data_integrity", contract: "canonical .skye contract validity" },
  { id: "gateway_shape", cmd: ["npm", ["run", "test:gateway-shape"]], blocking: true, area: "data_integrity", contract: "gateway response shape" },
  { id: "auth_regression", cmd: ["npm", ["run", "test:auth-regression"]], blocking: true, area: "reliability", contract: "auth regression" },
  { id: "export_import_schema", cmd: ["npm", ["run", "test:export-import-schema"]], blocking: true, area: "data_integrity", contract: "secure roundtrip, tamper rejection, and passphrase enforcement" },
  { id: "smoke_snapshot", cmd: ["npm", ["run", "check:smoke-snapshot"]], blocking: true, area: "reliability", contract: "smoke snapshot integrity" },
  { id: "build", cmd: ["npm", ["run", "build"]], blocking: true, area: "reliability", contract: "frontend build integrity" },
  { id: "release_artifacts", cmd: ["npm", ["run", "release:artifacts"]], blocking: true, area: "executive_readiness", contract: "release artifacts generation" },
  { id: "release_gates", cmd: ["npm", ["run", "release:gates"]], blocking: true, area: "executive_readiness", contract: "release gate evaluation" },
];

const results = [];
function writeChecklistSnapshot() {
  const blockingFailures = results.filter((r) => r.blocking && !r.ok).length;
  const payload = {
    generated_at: new Date().toISOString(),
    blocking_failures: blockingFailures,
    ok: blockingFailures === 0,
    checks: results,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
}

for (const check of checks) {
  // Persist current progress so downstream checks (for example release_gates)
  // can evaluate the latest checklist state from this same run.
  writeChecklistSnapshot();
  const started = Date.now();
  const proc = spawnSync(check.cmd[0], check.cmd[1], { cwd: root, stdio: "pipe", encoding: "utf8" });
  const durationMs = Date.now() - started;
  results.push({
    id: check.id,
    blocking: check.blocking,
    area: check.area,
    contract: check.contract,
    ok: proc.status === 0,
    exit_code: proc.status,
    duration_ms: durationMs,
    stdout: String(proc.stdout || "").slice(-1200),
    stderr: String(proc.stderr || "").slice(-1200),
  });
  writeChecklistSnapshot();
}

const blockingFailures = results.filter((r) => r.blocking && !r.ok).length;
console.log(`[release-checklist] Wrote ${path.relative(root, outFile)}`);
if (blockingFailures > 0) {
  console.error(`[release-checklist] FAILED: ${blockingFailures} blocking check(s).`);
  process.exit(1);
}
console.log("[release-checklist] PASS");
