/*
 * Helpers for generating and verifying signed download URLs for
 * objects stored in Cloudflare R2.  The signature uses an
 * HMAC-SHA256 over the object key and expiration timestamp.  The
 * signing key should be stored securely (e.g. EVIDENCE_SIGNING_KEY
 * secret).  Signed URLs include `key`, `exp` and `sig`
 * query parameters.
 */

/**
 * Constant time string comparison to mitigate timing attacks.  If
 * lengths differ the result is always false.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = 0;
  for (let i = 0; i < len; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0 && aa.length === bb.length;
}

/**
 * Compute an HMAC-SHA256 of the given message using the provided
 * signing key.  Returns the digest as a hex string.  The key is
 * imported as raw bytes for each call; caching is unnecessary
 * given the small number of operations.
 */
export async function hmacHex(keyStr: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Construct a signed download URL for an R2 object.  The URL
 * points to the /download endpoint of the Worker (baseUrl), and
 * includes `key`, `exp` and `sig` query parameters.  The
 * signature covers the key and expiration timestamp.
 */
export async function makeSignedDownloadURL(
  baseUrl: string,
  signingKey: string,
  key: string,
  expiresUnix: number
): Promise<string> {
  const msg = `${key}\n${expiresUnix}`;
  const sig = await hmacHex(signingKey, msg);
  const u = new URL(baseUrl);
  u.pathname = "/download";
  u.searchParams.set("key", key);
  u.searchParams.set("exp", String(expiresUnix));
  u.searchParams.set("sig", sig);
  return u.toString();
}

/**
 * Verify a signed download URL.  Returns true if the signature
 * matches and the URL has not expired.  Does not check that the
 * object exists in R2.  The caller must enforce expiry and
 * existence separately.
 */
export async function verifySignedDownload(
  signingKey: string,
  key: string,
  exp: number,
  sig: string
): Promise<boolean> {
  if (!key || !exp || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return false;
  const want = await hmacHex(signingKey, `${key}\n${exp}`);
  return timingSafeEqual(want, sig);
}