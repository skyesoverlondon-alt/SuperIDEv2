import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  const entries = readdirSync(dir);
  let count = 0;
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) count += walk(full);
    else count += 1;
  }
  return count;
}

console.log(walk(process.cwd()));
