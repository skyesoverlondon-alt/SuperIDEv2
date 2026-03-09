import crypto from "node:crypto";
console.log(`SIGNING_SECRET=${crypto.randomBytes(32).toString("hex")}`);
console.log(`COOKIE_SIGNING_SECRET=${crypto.randomBytes(32).toString("hex")}`);
