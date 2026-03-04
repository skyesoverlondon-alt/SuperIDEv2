type AccessEnv = {
  ACCESS_AUD?: string;
  ACCESS_JWKS_URL?: string;
  ACCESS_ISSUER?: string;
};

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

let jwkCache: { at: number; byKid: Map<string, Jwk> } | null = null;

function b64urlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function decodeJwtPart(part: string): any {
  const bytes = b64urlToUint8Array(part);
  const txt = new TextDecoder().decode(bytes);
  return JSON.parse(txt);
}

function u8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getJwkByKid(jwksUrl: string, kid: string): Promise<Jwk | null> {
  const now = Date.now();
  if (!jwkCache || now - jwkCache.at > 5 * 60_000) {
    const res = await fetch(jwksUrl, { method: "GET" });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Jwk[] };
    const byKid = new Map<string, Jwk>();
    for (const key of body.keys || []) {
      if (key.kid) byKid.set(key.kid, key);
    }
    jwkCache = { at: now, byKid };
  }
  return jwkCache.byKid.get(kid) || null;
}

export async function verifyAccessJwt(req: Request, env: AccessEnv): Promise<boolean> {
  const expectedAud = (env.ACCESS_AUD || "").trim();
  if (!expectedAud) return true;

  const assertion = req.headers.get("Cf-Access-Jwt-Assertion") || req.headers.get("cf-access-jwt-assertion") || "";
  if (!assertion) return false;

  const parts = assertion.split(".");
  if (parts.length !== 3) return false;

  let header: any;
  let payload: any;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return false;
  }

  if (header?.alg !== "RS256" || !header?.kid) return false;

  const exp = Number(payload?.exp || 0);
  if (!exp || exp <= Math.floor(Date.now() / 1000)) return false;

  const iss = String(payload?.iss || "");
  const expectedIss = (env.ACCESS_ISSUER || "").trim();
  if (expectedIss && iss !== expectedIss) return false;

  const aud = payload?.aud;
  const audList = Array.isArray(aud) ? aud.map(String) : aud ? [String(aud)] : [];
  if (!audList.includes(expectedAud)) return false;

  const jwksUrl =
    (env.ACCESS_JWKS_URL || "").trim() || "https://skyesoverlondon.cloudflareaccess.com/cdn-cgi/access/certs";
  const jwk = await getJwkByKid(jwksUrl, header.kid);
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  );

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToUint8Array(parts[2]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, u8ToArrayBuffer(sig), u8ToArrayBuffer(data));
}
