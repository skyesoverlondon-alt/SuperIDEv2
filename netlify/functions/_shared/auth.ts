import { q } from "./neon";
import { json } from "./response";
import { opt } from "./env";

const COOKIE = "kx_session";

// Node crypto for hashing and HMAC
import crypto from "crypto";

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function pbkdf2Hash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      Buffer.from(salt, "base64"),
      150000,
      32,
      "sha256",
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(base64url(derivedKey));
      }
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("base64");
  const hash = await pbkdf2Hash(password, salt);
  return `pbkdf2$sha256$150000$${salt}$${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length < 6) return false;
  const salt = parts[4];
  const want = parts[5];
  const got = await pbkdf2Hash(password, salt);
  return timingSafeEqual(got, want);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((p) => {
    const [k, ...rest] = p.trim().split("=");
    out[k] = rest.join("=") || "";
  });
  return out;
}

export function readFounderGatewayKey(event: any): string {
  const headers = event?.headers || {};
  return String(
    headers["x-founders-gateway-key"] ||
      headers["X-Founders-Gateway-Key"] ||
      headers["x-founder-gateway-key"] ||
      headers["X-Founder-Gateway-Key"] ||
      ""
  ).trim();
}

export function hasValidFounderGatewayKey(provided: string): boolean {
  const expected = opt("Founders_GateWay_Key", opt("FOUNDERS_GATEWAY_KEY", ""));
  return timingSafeEqual(String(provided || ""), String(expected || ""));
}

export async function resolveFounderGatewayUser(): Promise<{
  user_id: string;
  email: string;
  org_id: string | null;
} | null> {
  const configuredEmail = String(
    opt("Founders_GateWay_Email", opt("FOUNDERS_GATEWAY_EMAIL", ""))
  )
    .trim()
    .toLowerCase();

  const readUserByEmail = async (email: string) => {
    const res = await q(
      `select u.id as user_id, u.email, coalesce(u.org_id, m.org_id) as org_id
         from users u
         left join org_memberships m on m.user_id=u.id
        where lower(u.email)=lower($1)
        order by case when lower(coalesce(m.role, ''))='owner' then 0 else 1 end,
                 coalesce(m.org_id, u.org_id) asc,
                 u.id asc
        limit 1`,
      [email]
    );
    if (!res.rows.length) return null;
    return {
      user_id: res.rows[0].user_id,
      email: res.rows[0].email,
      org_id: res.rows[0].org_id || null,
    };
  };

  if (configuredEmail) {
    const configured = await readUserByEmail(configuredEmail);
    if (configured) return configured;
  }

  const founderLocal = await readUserByEmail("founder@skye.local");
  if (founderLocal) return founderLocal;

  const owner = await q(
    `select u.id as user_id, u.email, coalesce(u.org_id, m.org_id) as org_id
       from org_memberships m
       join users u on u.id=m.user_id
      where lower(coalesce(m.role, ''))='owner'
      order by m.org_id asc, u.id asc
      limit 1`,
    []
  );
  if (!owner.rows.length) return null;
  return {
    user_id: owner.rows[0].user_id,
    email: owner.rows[0].email,
    org_id: owner.rows[0].org_id || null,
  };
}

export async function requireUser(event: any): Promise<{
  user_id: string;
  email: string;
  org_id: string | null;
} | null> {
  const cookies = parseCookies(event.headers?.cookie);
  const token = cookies[COOKIE];
  if (!token) return null;
  const now = new Date().toISOString();
  const sess = await q(
    "select s.token, s.user_id, u.email, u.org_id from sessions s join users u on u.id=s.user_id where s.token=$1 and s.expires_at>$2",
    [token, now]
  );
  if (!sess.rows.length) return null;
  return {
    user_id: sess.rows[0].user_id,
    email: sess.rows[0].email,
    org_id: sess.rows[0].org_id,
  };
}

export async function createSession(user_id: string) {
  const token = base64url(crypto.randomBytes(32));
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14); // 14 days
  await q(
    "insert into sessions(user_id, token, expires_at) values($1,$2,$3)",
    [user_id, token, expires.toISOString()]
  );
  return { token, expires };
}

export async function ensureUserRecoveryEmailColumn() {
  await q("alter table if exists users add column if not exists recovery_email text", []);
  await q("create index if not exists idx_users_recovery_email on users(lower(recovery_email))", []);
}

export async function ensureUserPinColumns() {
  await q("alter table if exists users add column if not exists pin_hash text", []);
  await q("alter table if exists users add column if not exists pin_updated_at timestamptz", []);
}

function shouldUseSecureCookie(event?: any): boolean {
  const protoHeader = String(
    event?.headers?.["x-forwarded-proto"] ||
      event?.headers?.["X-Forwarded-Proto"] ||
      ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (protoHeader === "https") return true;
  if (protoHeader === "http") return false;

  const host = String(event?.headers?.host || event?.headers?.Host || "")
    .trim()
    .toLowerCase()
    .split(":")[0];

  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) {
    return false;
  }

  return true;
}

export function setSessionCookie(token: string, expires: Date, event?: any): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax;${shouldUseSecureCookie(event) ? " Secure;" : ""} Expires=${expires.toUTCString()}`;
}

export function clearSessionCookie(event?: any): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax;${shouldUseSecureCookie(event) ? " Secure;" : ""} Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function forbid() {
  return json(401, { error: "Unauthorized" });
}