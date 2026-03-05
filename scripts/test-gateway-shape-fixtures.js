#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, "docs", "gateway-shape-fixtures.json");

if (!fs.existsSync(fixturePath)) {
  console.error(`[gateway-shape] Missing fixture ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
let failed = false;

for (const f of fixtures) {
  const r = f.response || {};
  if (f.kind === "success") {
    const hasPayload = ["text", "output", "message"].some((k) => typeof r[k] === "string" && r[k].trim());
    if (!hasPayload) {
      console.error(`[gateway-shape] ${f.id}: missing tolerant success payload (text|output|message)`);
      failed = true;
    }
  } else if (f.kind === "error") {
    const hasError = typeof r.error === "string" || typeof r.message === "string";
    if (!hasError) {
      console.error(`[gateway-shape] ${f.id}: missing tolerant error payload (error|message)`);
      failed = true;
    }
  } else {
    console.error(`[gateway-shape] ${f.id}: unknown fixture kind '${f.kind}'`);
    failed = true;
  }
}

if (failed) {
  console.error("[gateway-shape] FAILED");
  process.exit(1);
}

console.log(`[gateway-shape] PASS (${fixtures.length} fixtures)`);
