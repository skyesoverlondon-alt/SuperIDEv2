#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checklistPath = path.join(root, "artifacts", "release-checklist.json");
const artifactPath = path.join(root, "artifacts", "release-artifacts.json");
const outPath = path.join(root, "artifacts", "release-gates.json");

if (!fs.existsSync(checklistPath)) {
  console.error("[release-gates] Missing artifacts/release-checklist.json");
  process.exit(1);
}

const checklist = JSON.parse(fs.readFileSync(checklistPath, "utf8"));
const checks = new Map((checklist.checks || []).map((c) => [c.id, Boolean(c.ok)]));
const hasArtifacts = fs.existsSync(artifactPath);

function all(ids) {
  return ids.every((id) => checks.get(id) === true);
}

const gates = {
  security: {
    required: ["gateway_only", "provider_strings", "secure_defaults", "external_endpoints", "protected_apps"],
  },
  reliability: {
    required: ["build", "smoke_snapshot", "auth_regression"],
  },
  data_integrity: {
    required: ["skye_schema", "gateway_shape", "export_import_schema"],
  },
  executive_readiness: {
    required: ["release_artifacts"],
  },
};

const results = {
  generated_at: new Date().toISOString(),
  gates: {
    security: all(gates.security.required),
    reliability: all(gates.reliability.required),
    data_integrity: all(gates.data_integrity.required),
    executive_readiness: hasArtifacts,
  },
  required: gates,
};

const ok = Object.values(results.gates).every(Boolean);
results.ok = ok;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`[release-gates] Wrote ${path.relative(root, outPath)}`);

if (!ok) {
  console.error("[release-gates] FAILED: one or more release gates did not pass");
  process.exit(1);
}

console.log("[release-gates] PASS");
