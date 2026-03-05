#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "public/SkyeBookx/index.html",
  "public/SkyePlatinum/index.html",
  "public/REACT2HTML/index.html",
];

const forbidden = [
  /openai/i,
  /gemini/i,
  /anthropic/i,
  /api\.openai\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /anthropic\.com\/v1/i,
  /chat\/completions/i,
  /images\/generations/i,
];

let failed = false;
for (const rel of files) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[provider-strings] Missing file: ${rel}`);
    failed = true;
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const rule of forbidden) {
    if (rule.test(text)) {
      console.error(`[provider-strings] Forbidden provider string ${rule} in ${rel}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[provider-strings] FAILED");
  process.exit(1);
}

console.log("[provider-strings] PASS");
