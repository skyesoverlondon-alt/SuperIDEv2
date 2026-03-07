import { json } from "./_shared/response";
import { requireUser, forbid, ensureUserPinColumns, hashPassword } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

const PIN_RE = /^[A-Za-z0-9]{4,12}$/;

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  await ensureUserPinColumns();

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const pin = String(body.pin || "").trim();
  const confirmPin = String(body.confirm_pin || body.confirmPin || "").trim();
  if (!PIN_RE.test(pin)) {
    return json(400, { error: "PIN must be 4-12 letters and numbers only." });
  }
  if (confirmPin && pin !== confirmPin) {
    return json(400, { error: "PIN confirmation does not match." });
  }

  const pinHash = await hashPassword(pin);
  await q("update users set pin_hash=$1, pin_updated_at=now() where id=$2", [pinHash, u.user_id]);
  await audit(u.email, u.org_id, null, "auth.pin.set", { has_pin: true });

  return json(200, { ok: true, has_pin: true });
};