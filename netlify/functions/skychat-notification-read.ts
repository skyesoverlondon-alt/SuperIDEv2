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
    body = {};
  }

  const id = String(body.id || "").trim();
  const markAll = Boolean(body.all);
  const kind = String(body.kind || "").trim().toLowerCase();
  const read = body.read === false ? false : true;

  if (!id && !markAll) {
    return json(400, { error: "Provide notification id or set all=true." });
  }

  if (id) {
    const res = await q(
      `update app_records
       set payload=jsonb_set(payload, '{read}', to_jsonb($1::boolean), true), updated_at=now()
       where org_id=$2 and app='SkyeNotification' and id=$3 and coalesce(payload->>'target_user_id','')=$4
       returning id`,
      [read, u.org_id, id, u.user_id]
    );
    if (!res.rows.length) return json(404, { error: "Notification not found." });
    await audit(u.email, u.org_id, null, "skychat.notification.read", { id, read });
    return json(200, { ok: true, id, read });
  }

  const updated = await q(
    `update app_records
     set payload=jsonb_set(payload, '{read}', to_jsonb($1::boolean), true), updated_at=now()
     where org_id=$2
       and app='SkyeNotification'
       and coalesce(payload->>'target_user_id','')=$3
       and ($4::text='' or lower(coalesce(payload->>'kind',''))=$4)
     returning id`,
    [read, u.org_id, u.user_id, kind]
  );

  await audit(u.email, u.org_id, null, "skychat.notification.read.bulk", {
    read,
    kind: kind || null,
    count: updated.rows.length,
  });

  return json(200, { ok: true, read, kind: kind || null, updated: updated.rows.length });
};
