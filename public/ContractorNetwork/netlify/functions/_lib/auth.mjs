import { unauthorized, forbidden } from "./resp.mjs";

function b64urlEncode(bytes) {
  const b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecodeToBuf(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}
async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "utf-8"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, Buffer.from(data, "utf-8"));
  return new Uint8Array(sig);
}
export async function signAdminJWT(payload, { secret, expiresInSec = 60 * 60 * 8 } = {}) {
  if (!secret) throw new Error("Missing ADMIN_JWT_SECRET");
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + expiresInSec };
  const p1 = b64urlEncode(Buffer.from(JSON.stringify(header), "utf-8"));
  const p2 = b64urlEncode(Buffer.from(JSON.stringify(full), "utf-8"));
  const msg = `${p1}.${p2}`;
  const sig = await hmacSha256(secret, msg);
  const p3 = b64urlEncode(sig);
  return `${msg}.${p3}`;
}
export async function verifyAdminJWT(token, { secret } = {}) {
  if (!token || typeof token !== "string") return null;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [p1, p2, p3] = parts;
  const msg = `${p1}.${p2}`;
  const sig = b64urlDecodeToBuf(p3);
  const expected = await hmacSha256(secret, msg);
  const equal = Buffer.compare(Buffer.from(expected), Buffer.from(sig)) === 0;
  if (!equal) return null;
  let payload = null;
  try { payload = JSON.parse(b64urlDecodeToBuf(p2).toString("utf-8")); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}
function parseBool(v) { return String(v || "").toLowerCase() === "true"; }
function parseAllowlist(v) {
  return String(v || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}
export async function requireAdmin(context, request) {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const secret = process.env.ADMIN_JWT_SECRET || "";
  const verified = await verifyAdminJWT(bearer, { secret });
  if (verified && verified.role === "admin") return { mode: "password", actor: verified.sub || "admin" };

  const user = context?.clientContext?.user;
  if (user) {
    const anyone = parseBool(process.env.ADMIN_IDENTITY_ANYONE);
    const allow = parseAllowlist(process.env.ADMIN_EMAIL_ALLOWLIST);
    const email = String(user.email || "").toLowerCase();
    if (anyone || (email && allow.includes(email))) return { mode: "identity", actor: email || "identity-user" };
    throw forbidden("Identity user not allowlisted");
  }

  throw unauthorized("Missing or invalid admin authorization");
}
