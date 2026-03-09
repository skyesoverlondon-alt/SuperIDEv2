import crypto from "crypto";
import { q } from "./neon";
import { clampArray, clampString, resolveContractorIntakeTarget } from "./contractor-network";

type AdminClaims = {
  role: "admin";
  sub: string;
  mode?: "password" | "identity";
  iat?: number;
  exp?: number;
};

type AdminPrincipal = {
  actor: string;
  mode: "password" | "identity";
};

function base64urlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(input: string) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
}

function hmacSha256(secret: string, payload: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest();
}

function parseBool(value: unknown) {
  return String(value || "").trim().toLowerCase() === "true";
}

function parseAllowlist(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function createHttpError(status: number, message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = status;
  return error;
}

export function contractorJson(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function contractorErrorResponse(error: unknown, fallbackMessage: string) {
  const message = String((error as any)?.message || fallbackMessage);
  const statusCode = Number((error as any)?.statusCode || 500);
  return contractorJson(statusCode, { error: message });
}

export function normalizeStatus(value: unknown) {
  const normalized = clampString(value, 40).toLowerCase();
  const allowed = new Set(["new", "reviewing", "approved", "on_hold", "rejected"]);
  return allowed.has(normalized) ? normalized : "reviewing";
}

export function normalizeTags(value: unknown) {
  return clampArray(value, 20, 48);
}

export async function signContractorAdminJwt(
  payload: Pick<AdminClaims, "role" | "sub" | "mode">,
  secret: string,
  expiresInSeconds = 60 * 60 * 12
) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: AdminClaims = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const body = base64urlEncode(JSON.stringify(claims));
  const message = `${header}.${body}`;
  const signature = base64urlEncode(hmacSha256(secret, message));
  return `${message}.${signature}`;
}

export async function verifyContractorAdminJwt(token: string, secret: string) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !secret) return null;
  const [header, body, signature] = parts;
  const message = `${header}.${body}`;
  const expected = base64urlEncode(hmacSha256(secret, message));
  const actual = String(signature || "");
  if (!expected || expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return null;
  try {
    const claims = JSON.parse(base64urlDecode(body).toString("utf-8")) as AdminClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && now > claims.exp) return null;
    if (claims.role !== "admin") return null;
    return claims;
  } catch {
    return null;
  }
}

export async function requireContractorAdmin(request: Request, context?: any): Promise<AdminPrincipal> {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const secret = String(process.env.ADMIN_JWT_SECRET || "").trim();

  if (bearer && secret) {
    const claims = await verifyContractorAdminJwt(bearer, secret);
    if (claims?.role === "admin") {
      return {
        actor: claims.sub || "contractor-admin",
        mode: claims.mode === "identity" ? "identity" : "password",
      };
    }
  }

  const identityUser = context?.clientContext?.user;
  if (identityUser) {
    const allowAnyone = parseBool(process.env.ADMIN_IDENTITY_ANYONE);
    const allowlist = parseAllowlist(process.env.ADMIN_EMAIL_ALLOWLIST);
    const email = clampString(identityUser.email, 254).toLowerCase();
    if (allowAnyone || (email && allowlist.includes(email))) {
      return { actor: email || "identity-user", mode: "identity" };
    }
    throw createHttpError(403, "Identity user not allowlisted.");
  }

  throw createHttpError(401, "Missing or invalid admin authorization.");
}

export function readContractorQueryLimit(raw: string | null, fallback = 100, max = 200) {
  const parsed = Number(raw || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

export function normalizeContractorLanes(raw: unknown) {
  if (Array.isArray(raw)) return raw.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [] as string[];
}

export function normalizeContractorTags(raw: unknown) {
  if (Array.isArray(raw)) return raw.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [] as string[];
}

export async function resolveContractorAdminScope() {
  return resolveContractorIntakeTarget();
}

export async function contractorHealthProbe() {
  await q("select 1 as one", []);
}
