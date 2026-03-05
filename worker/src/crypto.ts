/*
 * Cryptographic helpers for the Cloudflare Worker.  Implements
 * HMAC signing, SHA-256 hashing, constant time comparisons and
 * AES-GCM encryption/decryption for vaulting secrets.  Also
 * exposes a helper to verify runner signatures on incoming
 * requests.  All functions are pure and return promises where
 * asynchronous WebCrypto APIs are used.
 */

function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = 0;
  for (let i = 0; i < len; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0 && aa.length === bb.length;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute an HMAC-SHA256 signature and return the result as a hex
 * string.  The key is provided as a raw string and is SHA-256
 * hashed before use to derive a 32 byte key.  This helper is used
 * for signing evidence manifests and verifying signed URLs.
 */
export async function hmacSigHex(keyStr: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const keyBytes = await crypto.subtle.digest("SHA-256", enc.encode(keyStr));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute an HMAC-SHA256 signature and return the result as a hex
 * string (alias for hmacSigHex).  Provided for compatibility with
 * earlier code references.
 */
export const hmacHex = hmacSigHex;

/**
 * Encrypt a token using AES-GCM with a master key.  The master key
 * string is hashed to derive 32 bytes of key material.  A random
 * 12 byte IV is generated for each encryption.  The returned
 * object contains base64url encoded IV and ciphertext.
 */
export async function encryptToken(masterKey: string, token: string): Promise<{ iv: string; ct: string }> {
  const enc = new TextEncoder();
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(masterKey)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
  return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

/**
 * Decrypt a token previously encrypted with encryptToken().  The
 * master key string must be the same as used for encryption.  The
 * returned plaintext is the original token.
 */
export async function decryptToken(masterKey: string, blob: { iv: string; ct: string }): Promise<string> {
  const enc = new TextEncoder();
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(masterKey)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = fromB64url(blob.iv);
  const ct = fromB64url(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(ct));
  return new TextDecoder().decode(pt);
}

/**
 * Verify an incoming request signature from Netlify Functions.  The
 * function reconstructs the canonical message as `${ts}\n${path}\n${body}`
 * and verifies the HMAC-SHA256 signature provided in the
 * X-KX-SIG header using the shared secret.  A timestamp skew of
 * ±5 minutes is allowed.
 */
export async function verifyRunnerSig(req: Request, secret: string, path: string, body: string): Promise<boolean> {
  const ts = req.headers.get("X-KX-TS") || "";
  const sig = req.headers.get("X-KX-SIG") || "";
  if (!ts || !sig) return false;
  const now = Date.now();
  const dt = Math.abs(now - Number(ts));
  if (!Number.isFinite(dt) || dt > 5 * 60 * 1000) return false;
  const canonical = `${ts}\n${path}\n${body}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  const expected = b64url(new Uint8Array(mac));
  return timingSafeEqual(expected, sig);
}