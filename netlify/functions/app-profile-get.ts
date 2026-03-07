import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

const ALLOWED_APPS = new Set(["SkyeMail", "SkyeChat", "SKYEMAIL-GEN", "Skye-ID"]);

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const app = String(params.app || "").trim();
  if (!ALLOWED_APPS.has(app)) {
    return json(400, { error: "Unsupported app profile." });
  }

  const row = await q(
    `select id, title, payload, updated_at
     from app_records
     where org_id=$1 and app=$2 and created_by=$3
     order by updated_at desc
     limit 1`,
    [u.org_id, `${app}Profile`, u.user_id]
  );

  if (!row.rows.length) {
    return json(200, { ok: true, profile: null });
  }

  const rec = row.rows[0];
  return json(200, {
    ok: true,
    profile: {
      id: rec.id,
      title: rec.title,
      payload: rec.payload || {},
      updated_at: rec.updated_at || null,
    },
  });
};
