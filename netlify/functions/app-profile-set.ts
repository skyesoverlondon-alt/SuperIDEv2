import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

const ALLOWED_APPS = new Set(["SkyeMail", "SkyeChat", "SKYEMAIL-GEN", "Skye-ID"]);

function safeTitle(value: unknown, fallback: string): string {
  const next = String(value || "").trim();
  return next.length ? next.slice(0, 120) : fallback;
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const app = String(body.app || "").trim();
  const payload = body?.profile && typeof body.profile === "object" ? body.profile : {};

  if (!ALLOWED_APPS.has(app)) {
    return json(400, { error: "Unsupported app profile." });
  }

  const title = safeTitle(body?.title, `${app} Profile`);
  const appKey = `${app}Profile`;

  try {
    const existing = await q(
      `select id
       from app_records
       where org_id=$1 and app=$2 and created_by=$3
       order by updated_at desc
       limit 1`,
      [u.org_id, appKey, u.user_id]
    );

    let id = "";
    if (existing.rows.length) {
      id = String(existing.rows[0].id);
      await q(
        `update app_records
         set title=$1, payload=$2::jsonb, updated_at=now()
         where id=$3 and org_id=$4`,
        [title, JSON.stringify(payload), id, u.org_id]
      );
    } else {
      const created = await q(
        `insert into app_records(org_id, app, title, payload, created_by)
         values($1,$2,$3,$4::jsonb,$5)
         returning id`,
        [u.org_id, appKey, title, JSON.stringify(payload), u.user_id]
      );
      id = String(created.rows[0]?.id || "");
    }

    await audit(u.email, u.org_id, null, "app.profile.set", {
      app,
      profile_record_id: id || null,
    });

    return json(200, { ok: true, id: id || null });
  } catch (error: any) {
    return json(500, { error: error?.message || "Profile save failed." });
  }
};
