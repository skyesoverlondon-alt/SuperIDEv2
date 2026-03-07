import { json } from "./_shared/response";
import { requireUser, forbid, ensureUserPinColumns, verifyPassword } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";

const PIN_RE = /^[A-Za-z0-9]{4,12}$/;

const TTL_PRESETS_MINUTES: Record<string, number> = {
  "1h": 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
  month: 30 * 24 * 60,
  quarter: 90 * 24 * 60,
};

function resolveTtlMinutes(raw: any): number {
  const preset = String(raw || "day").trim().toLowerCase();
  return TTL_PRESETS_MINUTES[preset] || TTL_PRESETS_MINUTES.day;
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  await ensureUserPinColumns();

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const pin = String(body.pin || "").trim();
  const labelPrefix = String(body.label_prefix || "pin-unlock").trim().slice(0, 64) || "pin-unlock";
  const ttlMinutes = resolveTtlMinutes(body.ttl_preset);
  if (!PIN_RE.test(pin)) return json(400, { error: "PIN must be 4-12 letters and numbers only." });

  const userRow = await q("select pin_hash, email from users where id=$1 limit 1", [u.user_id]);
  const storedHash = String(userRow.rows[0]?.pin_hash || "").trim();
  const email = String(userRow.rows[0]?.email || u.email || "").trim().toLowerCase();
  if (!storedHash) return json(400, { error: "No session PIN is configured for this account." });

  const ok = await verifyPassword(pin, storedHash);
  if (!ok) {
    await audit(u.email, u.org_id, null, "auth.pin.unlock.failed", { reason: "invalid_pin" });
    return json(401, { error: "Invalid PIN." });
  }

  await q(
    "update api_tokens set status='revoked', revoked_at=now() where org_id=$1 and issued_by=$2 and status='active' and label like $3",
    [u.org_id, u.user_id, `${labelPrefix}%`]
  );

  const token = mintApiToken();
  const prefix = token.slice(0, 14);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const label = `${labelPrefix}-${new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "")}`;

  const inserted = await q(
    "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning id, created_at, expires_at, locked_email, scopes_json",
    [u.org_id, u.user_id, label, tokenHash(token), prefix, expiresAt, email || null, JSON.stringify(["generate"])]
  );

  await audit(u.email, u.org_id, null, "auth.pin.unlock", {
    label,
    ttl_minutes: ttlMinutes,
    locked_email: email || null,
  });

  return json(200, {
    ok: true,
    unlocked: true,
    token,
    locked_email: inserted.rows[0]?.locked_email || email || null,
    label,
    prefix,
    created_at: inserted.rows[0]?.created_at || null,
    expires_at: inserted.rows[0]?.expires_at || expiresAt,
    scopes: Array.isArray(inserted.rows[0]?.scopes_json) ? inserted.rows[0].scopes_json : ["generate"],
  });
};