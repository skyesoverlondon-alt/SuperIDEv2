#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const smokePath = path.join(root, "scripts", "smokehouse.sh");
const snapshotPath = path.join(root, "docs", "smoke-expected-snapshot.json");

if (!fs.existsSync(smokePath) || !fs.existsSync(snapshotPath)) {
  console.error("[smoke-snapshot] Missing smokehouse.sh or snapshot fixture");
  process.exit(1);
}

const smoke = fs.readFileSync(smokePath, "utf8");
const expected = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

const actualNames = [];
for (const line of smoke.split(/\r?\n/)) {
  const m = line.match(/^\s*check\s+"([^"]+)"\s+/);
  if (m) actualNames.push(m[1]);
}

const mismatch = JSON.stringify(actualNames) !== JSON.stringify(expected.checks || []);
if (mismatch) {
  console.error("[smoke-snapshot] FAILED: deterministic check list changed");
  console.error(`[smoke-snapshot] expected=${JSON.stringify(expected.checks || [])}`);
  console.error(`[smoke-snapshot] actual=${JSON.stringify(actualNames)}`);
  process.exit(1);
}

console.log(`[smoke-snapshot] PASS (${actualNames.length} checks)`);
