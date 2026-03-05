import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { hasValidMasterSequence, mintApiToken, tokenHash } from "./_shared/api_tokens";
import { opt } from "./_shared/env";

const TTL_PRESETS_MINUTES: Record<string, number> = {
  test_2m: 2,
  "1h": 60,
  "5h": 5 * 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
  month: 30 * 24 * 60,
  quarter: 90 * 24 * 60,
  quarterly: 90 * 24 * 60,
  year: 365 * 24 * 60,
  annual: 365 * 24 * 60,
};

function resolveTtlMinutes(body: any): { minutes: number; mode: string } {
  const preset = String(body.ttl_preset || "").trim().toLowerCase();
  if (preset && TTL_PRESETS_MINUTES[preset]) {
    return { minutes: TTL_PRESETS_MINUTES[preset], mode: `preset:${preset}` };
  }

  if (body.ttl_minutes !== undefined) {
    const ttlMinutes = Math.max(1, Math.min(525600, Number(body.ttl_minutes)));
    return { minutes: ttlMinutes, mode: "minutes" };
  }

  if (body.ttl_days !== undefined) {
    const ttlDays = Math.max(1, Math.min(365, Number(body.ttl_days)));
    return { minutes: ttlDays * 24 * 60, mode: "days" };
  }

  return { minutes: 90 * 24 * 60, mode: "default:quarter" };
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }

  const count = Math.max(1, Math.min(200, Number(body.count || 1)));
  const ttl = resolveTtlMinutes(body);
  const labelPrefix = String(body.label_prefix || "token").slice(0, 64);
  const requestedLockedEmail = String(body.locked_email || "").trim().toLowerCase();
  const unlockRequested = body.unlock_email_lock === true;
  const scopes = ["generate"];
  const masterProvided = String(body.token_master_sequence || "");
  const masterExpected = opt("TOKEN_MASTER_SEQUENCE", "");
  const hasMaster = hasValidMasterSequence(masterProvided, masterExpected);

  if ((requestedLockedEmail && requestedLockedEmail !== u.email.toLowerCase()) || unlockRequested) {
    if (!hasMaster) {
      return json(403, { error: "Email lock override requires TOKEN_MASTER_SEQUENCE." });
    }
  }

  const lockedEmail = unlockRequested
    ? null
    : (requestedLockedEmail || u.email.toLowerCase());

  const issuer = await q("select id from users where email=$1 limit 1", [u.email.toLowerCase()]);
  const issuerId = issuer.rows[0]?.id || null;
  const startsAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl.minutes * 60 * 1000).toISOString();

  const issued: any[] = [];
  for (let i = 0; i < count; i++) {
    const token = mintApiToken();
    const prefix = token.slice(0, 14);
    const label = `${labelPrefix}-${i + 1}`;
    const inserted = await q(
      "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning id, created_at, expires_at, locked_email, scopes_json",
      [u.org_id, issuerId, label, tokenHash(token), prefix, expiresAt, lockedEmail, JSON.stringify(scopes)]
    );
    issued.push({
      id: inserted.rows[0].id,
      label,
      prefix,
      starts_at: startsAt,
      created_at: inserted.rows[0].created_at,
      expires_at: inserted.rows[0].expires_at,
      locked_email: inserted.rows[0].locked_email || null,
      scopes: Array.isArray(inserted.rows[0].scopes_json) ? inserted.rows[0].scopes_json : scopes,
      token,
    });
  }

  await audit(u.email, u.org_id, null, "token.issue", {
    count,
    ttl_mode: ttl.mode,
    ttl_minutes: ttl.minutes,
    label_prefix: labelPrefix,
    locked_email: lockedEmail,
    scopes,
    master_used: hasMaster,
  });

  return json(200, {
    ok: true,
    count: issued.length,
    ttl_mode: ttl.mode,
    ttl_minutes: ttl.minutes,
    issued,
    warning: "Tokens are only shown once. Store them securely now.",
    accepted_ttl_presets: ["test_2m", "1h", "5h", "day", "week", "month", "quarter", "quarterly", "year", "annual"],
  });
};
