import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

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

  const channel = String(body.channel || "").trim();
  const message = String(body.message || "").trim();
  const source = String(body.source || "manual").trim();

  if (!channel || !message) {
    return json(400, { error: "Missing channel or message." });
  }

  try {
    const row = await q(
      "insert into app_records(org_id, app, title, payload, created_by) values($1,$2,$3,$4::jsonb,$5) returning id, created_at",
      [
        u.org_id,
        "SkyeChat",
        `#${channel}`,
        JSON.stringify({ channel, message, source }),
        u.user_id,
      ]
    );

    await audit(u.email, u.org_id, null, "skychat.notify.ok", {
      channel,
      source,
      record_id: row.rows[0]?.id || null,
    });

    return json(200, { ok: true, id: row.rows[0]?.id || null, created_at: row.rows[0]?.created_at || null });
  } catch (e: any) {
    const msg = e?.message || "SkyeChat notify failed.";
    await audit(u.email, u.org_id, null, "skychat.notify.failed", {
      channel,
      error: msg,
    });
    return json(500, { error: msg });
  }
};
