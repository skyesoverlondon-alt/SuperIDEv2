import crypto from "crypto";
import { json } from "./_shared/response";

function timingSafeMatches(left: string, right: string) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const expectedKey = String(process.env.ADMIN_KEY || "").trim();
  const expectedPassword = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!expectedKey && !expectedPassword) {
    return json(503, { error: "Neither ADMIN_KEY nor ADMIN_PASSWORD is configured." });
  }

  const body = await request.json().catch(() => ({}));
  const providedKey = String((body as { key?: unknown })?.key || "").trim();
  const matchesAdminKey = providedKey && expectedKey ? timingSafeMatches(providedKey, expectedKey) : false;
  const matchesAdminPassword = providedKey && expectedPassword ? timingSafeMatches(providedKey, expectedPassword) : false;
  if (!providedKey || (!matchesAdminKey && !matchesAdminPassword)) {
    return json(401, { error: "Invalid admin board credential." });
  }

  return json(200, {
    ok: true,
    credential_type: matchesAdminKey ? "ADMIN_KEY" : "ADMIN_PASSWORD",
  });
};