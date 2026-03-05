#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts");
const checklistPath = path.join(outDir, "release-checklist.json");
const outPath = path.join(outDir, "release-artifacts.json");

const checklist = fs.existsSync(checklistPath)
  ? JSON.parse(fs.readFileSync(checklistPath, "utf8"))
  : { ok: false, checks: [] };

const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const ts = new Date().toISOString();

const payload = {
  generated_at: ts,
  branch,
  commit,
  checklist_ok: Boolean(checklist.ok),
  checklist_checks: (checklist.checks || []).map((c) => ({ id: c.id, ok: c.ok })),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`[release-artifacts] Wrote ${path.relative(root, outPath)}`);
