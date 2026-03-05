#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const filesToCheck = [
  "public/SkyeBookx/index.html",
  "public/SkyePlatinum/index.html",
  "public/REACT2HTML/index.html",
];

const forbiddenPatterns = [
  /api\.openai\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /anthropic\.com\/v1/i,
  /chat\/completions/i,
  /images\/generations/i,
  /openai/i,
  /gemini/i,
  /anthropic/i,
];

let failed = false;

for (const relPath of filesToCheck) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    console.error(`[gateway-check] Missing file: ${relPath}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(abs, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      console.error(`[gateway-check] Forbidden pattern ${pattern} in ${relPath}`);
      failed = true;
    }
  }

  if (!/\/api\/kaixu-generate/.test(content)) {
    console.error(`[gateway-check] Missing gateway endpoint usage in ${relPath}`);
    failed = true;
  }
}

if (failed) {
  console.error("[gateway-check] FAILED: gateway-only policy violations found.");
  process.exit(1);
}

console.log("[gateway-check] PASS: gateway-only policy enforced.");
