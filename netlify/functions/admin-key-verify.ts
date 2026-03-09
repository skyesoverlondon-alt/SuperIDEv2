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
  if (!expectedKey) {
    return json(503, { error: "ADMIN_KEY is not configured." });
  }

  const body = await request.json().catch(() => ({}));
  const providedKey = String((body as { key?: unknown })?.key || "").trim();
  if (!providedKey || !timingSafeMatches(providedKey, expectedKey)) {
    return json(401, { error: "Invalid admin key." });
  }

  return json(200, { ok: true });
};