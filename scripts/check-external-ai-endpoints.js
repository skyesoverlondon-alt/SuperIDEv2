#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = ["public", "src", "netlify/functions"];
const forbidden = [
  /https?:\/\/api\.openai\.com/i,
  /https?:\/\/generativelanguage\.googleapis\.com/i,
  /https?:\/\/api\.anthropic\.com/i,
  /chat\/completions/i,
  /images\/generations/i,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(html|ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = scanRoots.flatMap((rel) => walk(path.join(root, rel)));
let failed = false;

for (const file of files) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.test(text)) {
      console.error(`[external-endpoints] Forbidden endpoint pattern ${rule} in ${rel}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[external-endpoints] FAILED");
  process.exit(1);
}

console.log(`[external-endpoints] PASS (${files.length} files scanned)`);
