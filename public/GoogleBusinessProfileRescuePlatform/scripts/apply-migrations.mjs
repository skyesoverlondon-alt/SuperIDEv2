import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("infra/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
console.log("Apply these migrations in order:");
for (const file of files) console.log(`- ${file}`);
console.log("\nExample:");
console.log("wrangler d1 execute gbp-rescue-db --file infra/migrations/001_init.sql");
