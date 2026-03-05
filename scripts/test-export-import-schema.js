#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, "docs", "export-import-fixtures.json");

if (!fs.existsSync(fixturePath)) {
  console.error(`[export-import-schema] Missing fixture ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
let failed = false;

for (const f of fixtures) {
  if (!f.meta || typeof f.meta !== "object") {
    console.error(`[export-import-schema] ${f.id}: missing meta`);
    failed = true;
    continue;
  }
  if (!f.meta.app_id || !f.meta.schema_version) {
    console.error(`[export-import-schema] ${f.id}: missing meta.app_id or meta.schema_version`);
    failed = true;
  }
  if (!f.state || typeof f.state !== "object") {
    console.error(`[export-import-schema] ${f.id}: missing state object`);
    failed = true;
  }
}

if (failed) {
  console.error("[export-import-schema] FAILED");
  process.exit(1);
}

console.log(`[export-import-schema] PASS (${fixtures.length} fixtures)`);
