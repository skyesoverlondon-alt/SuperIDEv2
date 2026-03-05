#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, "docs", "skye-schema-fixture.json");

function validateEnvelope(obj) {
  if (!obj || typeof obj !== "object") return "Envelope is not an object";
  if (!obj.meta || typeof obj.meta !== "object") return "Missing meta object";
  if (!obj.meta.app_id) return "Missing meta.app_id";
  const version = Number(obj.meta.schema_version || 0);
  if (!Number.isFinite(version) || version < 1) return "Invalid meta.schema_version";
  if (!obj.state || typeof obj.state !== "object") return "Missing state object";
  return "";
}

if (!fs.existsSync(fixturePath)) {
  console.error(`[skye-schema] Missing fixture: ${fixturePath}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (error) {
  console.error(`[skye-schema] Invalid JSON fixture: ${error.message}`);
  process.exit(1);
}

const samples = Array.isArray(parsed) ? parsed : [parsed];
let failed = false;
for (let i = 0; i < samples.length; i += 1) {
  const err = validateEnvelope(samples[i]);
  if (err) {
    console.error(`[skye-schema] Sample #${i + 1} failed: ${err}`);
    failed = true;
  }
}

if (failed) {
  console.error("[skye-schema] FAILED");
  process.exit(1);
}

console.log(`[skye-schema] PASS (${samples.length} sample${samples.length === 1 ? "" : "s"})`);
