import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  let files = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files = files.concat(walk(full));
    else files.push(full);
  }
  return files;
}

const files = walk(process.cwd());
console.log(JSON.stringify({
  totalFiles: files.length,
  phase: "phase2",
  hasMonitoringRoute: files.some((file) => file.endsWith("monitoring.ts")),
  hasChecklistRoute: files.some((file) => file.endsWith("checklists.ts"))
}, null, 2));
