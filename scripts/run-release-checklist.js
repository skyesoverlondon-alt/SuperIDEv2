#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts");
const outFile = path.join(outDir, "release-checklist.json");

const checks = [
  { id: "gateway_only", cmd: ["npm", ["run", "check:gateway-only"]], blocking: true },
  { id: "provider_strings", cmd: ["npm", ["run", "check:provider-strings"]], blocking: true },
  { id: "secure_defaults", cmd: ["npm", ["run", "check:secure-defaults"]], blocking: true },
  { id: "skye_schema", cmd: ["npm", ["run", "check:skye-schema"]], blocking: true },
  { id: "build", cmd: ["npm", ["run", "build"]], blocking: true },
];

const results = [];
for (const check of checks) {
  const started = Date.now();
  const proc = spawnSync(check.cmd[0], check.cmd[1], { cwd: root, stdio: "pipe", encoding: "utf8" });
  const durationMs = Date.now() - started;
  results.push({
    id: check.id,
    blocking: check.blocking,
    ok: proc.status === 0,
    exit_code: proc.status,
    duration_ms: durationMs,
    stdout: String(proc.stdout || "").slice(-1200),
    stderr: String(proc.stderr || "").slice(-1200),
  });
}

const blockingFailures = results.filter((r) => r.blocking && !r.ok).length;
const payload = {
  generated_at: new Date().toISOString(),
  blocking_failures: blockingFailures,
  ok: blockingFailures === 0,
  checks: results,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
console.log(`[release-checklist] Wrote ${path.relative(root, outFile)}`);
if (blockingFailures > 0) {
  console.error(`[release-checklist] FAILED: ${blockingFailures} blocking check(s).`);
  process.exit(1);
}
console.log("[release-checklist] PASS");
