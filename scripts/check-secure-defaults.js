#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredSnippets = [
  {
    file: "public/SkyeBookx/index.html",
    mustContain: ["X-Correlation-Id", "Bearer", "/api/kaixu-generate"],
  },
  {
    file: "public/SkyePlatinum/index.html",
    mustContain: ["X-Correlation-Id", "Bearer", "/api/kaixu-generate"],
  },
  {
    file: "public/REACT2HTML/index.html",
    mustContain: ["X-Correlation-Id", "Bearer", "/api/kaixu-generate"],
  },
  {
    file: "public/SkyeMail/index.html",
    mustContain: ["X-Correlation-Id", "X-Token-Email"],
  },
  {
    file: "public/SkyeChat/index.html",
    mustContain: ["X-Correlation-Id", "X-Token-Email"],
  },
  {
    file: "public/SkyeTasks/index.html",
    mustContain: ["X-Correlation-Id", "X-Token-Email"],
  },
];

let failed = false;
for (const item of requiredSnippets) {
  const abs = path.join(root, item.file);
  if (!fs.existsSync(abs)) {
    console.error(`[secure-defaults] Missing file: ${item.file}`);
    failed = true;
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const needle of item.mustContain) {
    if (!text.includes(needle)) {
      console.error(`[secure-defaults] Missing '${needle}' in ${item.file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[secure-defaults] FAILED: secure defaults policy mismatch.");
  process.exit(1);
}

console.log("[secure-defaults] PASS: required secure defaults are present.");
