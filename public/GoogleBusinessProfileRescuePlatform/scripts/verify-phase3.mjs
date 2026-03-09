import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) total += countFiles(path);
    else total += 1;
  }
  return total;
}

console.log(JSON.stringify({ phase: 3, files: countFiles(process.cwd()) }, null, 2));
