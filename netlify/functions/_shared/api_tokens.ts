import crypto from "crypto";
import { q } from "./neon";

export const ALLOWED_TOKEN_SCOPES = [
  "generate",
  "deploy",
  "export",
  "admin",
] as const;

export type TokenScope = (typeof ALLOWED_TOKEN_SCOPES)[number];

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function mintApiToken(): string {
  return `kx_at_${base64url(crypto.randomBytes(32))}`;
}

export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function resolveApiToken(token: string): Promise<{
  id: string;
  org_id: string;
  label: string | null;
  issued_by: string | null;
  locked_email: string | null;
  scopes: string[];
} | null> {
  const hash = tokenHash(token);
  const res = await q(
    "select id, org_id, label, issued_by, locked_email, scopes_json from api_tokens where token_hash=$1 and status='active' and (expires_at is null or expires_at > now()) limit 1",
    [hash]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  await q("update api_tokens set last_used_at=now() where id=$1", [row.id]);
  return {
    id: row.id,
    org_id: row.org_id,
    label: row.label || null,
    issued_by: row.issued_by || null,
    locked_email: row.locked_email || null,
    scopes: Array.isArray(row.scopes_json) ? row.scopes_json.map(String) : ["generate"],
  };
}

export function readBearerToken(headers: Record<string, string | undefined>): string | null {
  const value =
    headers.authorization ||
    headers.Authorization ||
    headers.AUTHORIZATION ||
    "";
  const m = value.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function hasValidMasterSequence(provided: string, expected: string): boolean {
  const a = String(provided || "");
  const b = String(expected || "");
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function normalizeTokenScopes(input: any): string[] {
  const raw = Array.isArray(input) ? input.map((x) => String(x).trim().toLowerCase()) : [];
  const deduped = Array.from(new Set(raw.filter(Boolean)));
  const valid = deduped.filter((s) => ALLOWED_TOKEN_SCOPES.includes(s as TokenScope));
  return valid.length ? valid : ["generate"];
}

export function tokenHasScope(scopes: string[] | undefined, required: TokenScope): boolean {
  const actual = Array.isArray(scopes) ? scopes : [];
  return actual.includes(required) || actual.includes("admin");
}
