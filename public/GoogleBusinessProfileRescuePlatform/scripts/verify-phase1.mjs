import { existsSync, readFileSync } from "node:fs";

const required = [
  "apps/web/src/pages/Dashboard.tsx",
  "apps/worker-api/src/index.ts",
  "infra/migrations/001_init.sql",
  "docs/phase-1-ledger.md"
];

const missing = required.filter((path) => !existsSync(path));

if (missing.length) {
  console.error("Missing required Phase 1 files:", missing);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!pkg.workspaces?.length) {
  console.error("Expected workspace config missing.");
  process.exit(1);
}

console.log("Phase 1 structure verification passed.");
