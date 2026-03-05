/*
 * Helpers for interacting with the GitHub App installation API.
 * Provides utilities to construct a JWT signed with the app's
 * private key and to mint an installation access token.  These
 * functions rely only on WebCrypto and the GitHub REST API and
 * do not require external dependencies.  See the GitHub docs
 * for more details:
 * https://docs.github.com/en/rest/overview/other-authentication-methods#using-json-web-tokens
 */

/**
 * Base64url encode a Uint8Array.  Trailing '=' padding is
 * removed and '+' and '/' characters are replaced with
 * URL‑safe equivalents.
 */
function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Convert a string to a Uint8Array using UTF‑8 encoding.
 */
function strToU8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Convert a PEM encoded private key to DER (binary) form.
 * Strips header/footer lines and whitespace.  The return value
 * can be passed directly to crypto.subtle.importKey().
 */
function pemToDer(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Import an RSA private key in PKCS8 PEM format for RSASSA-PKCS1-v1_5.
 */
async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Sign arbitrary data with the provided private key using
 * RSASSA-PKCS1-v1_5 and SHA-256.  Returns the signature as a
 * Uint8Array.
 */
async function signRS256(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, toArrayBuffer(data));
  return new Uint8Array(sig);
}

/**
 * Construct a JWT for authenticating as a GitHub App.  The
 * returned token is signed with the app's private key and has a
 * 9 minute expiry (GitHub recommends < 10 minutes).  The app
 * identifier is the `iss` claim.  The token is valid only to
 * request installation tokens, not to call arbitrary endpoints.
 */
export async function makeGitHubAppJWT(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 10,
    exp: now + 9 * 60,
    iss: appId,
  };
  const h = b64url(strToU8(JSON.stringify(header)));
  const p = b64url(strToU8(JSON.stringify(payload)));
  const signingInput = `${h}.${p}`;
  const key = await importPkcs8PrivateKey(privateKeyPem);
  const sig = await signRS256(key, strToU8(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * Low level GitHub API helper.  Accepts the API path (with
 * leading slash), a bearer token, HTTP method and optional body
 * object.  Returns the parsed JSON response or throws on error.
 */
async function gh(apiPath: string, token: string, method: string, body?: any): Promise<any> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "kaixu-superide-runner",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.message || `GitHub API error (${res.status})`);
  }
  return data;
}

/**
 * Mint an installation access token from GitHub using the App
 * credentials.  The Worker environment must provide
 * GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.  The returned token
 * is short lived (typically 1 hour) and can be used to call
 * repository APIs on behalf of the installation.
 */
export async function getInstallationToken(env: any, installationId: number): Promise<string> {
  const appId = env.GITHUB_APP_ID;
  const pk = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !pk) throw new Error("Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY in Worker secrets.");
  const jwt = await makeGitHubAppJWT(String(appId), String(pk));
  const out = await gh(`/app/installations/${installationId}/access_tokens`, jwt, "POST", {});
  if (!out?.token) throw new Error("Failed to obtain installation token.");
  return out.token as string;
}