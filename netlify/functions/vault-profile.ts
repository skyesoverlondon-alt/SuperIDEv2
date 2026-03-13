import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

const APP_KEY = "SkyeVaultProfile";

function tierDrive(planTier: string = "core") {
  const tier = String(planTier || "core").trim().toLowerCase();
  if (tier === "pro") return "1TB";
  if (tier === "flow") return "512GB";
  return "256GB";
}

async function readProfile(orgId: string, userId: string) {
  const row = await q(
    `select id, payload, updated_at
       from app_records
      where org_id=$1 and app=$2 and created_by=$3
      order by updated_at desc
      limit 1`,
    [orgId, APP_KEY, userId]
  );
  return row.rows[0] || null;
}

export const handler = async (event: any) => {
  const user = await requireUser(event);
  if (!user) return forbid();
  if (!user.org_id) return json(400, { error: "User has no org." });

  const method = String(event.httpMethod || "GET").toUpperCase();

  if (method === "GET") {
    const row = await readProfile(user.org_id, user.user_id);
    return json(200, {
      ok: true,
      profile: row ? { ...(row.payload || {}), updated_at: row.updated_at || null } : null,
      backend: "app_records",
    });
  }

  if (method === "POST") {
    let body: any = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }

    const profile = {
      user_id: user.user_id,
      email: user.email || "",
      full_name: String(body.full_name || "").trim(),
      plan_tier: String(body.plan_tier || "core").trim().toLowerCase(),
      shipping_name: String(body.shipping_name || "").trim(),
      shipping_email: String(body.shipping_email || user.email || "").trim(),
      shipping_address: String(body.shipping_address || "").trim(),
      shipping_city: String(body.shipping_city || "").trim(),
      shipping_state: String(body.shipping_state || "").trim(),
      shipping_zip: String(body.shipping_zip || "").trim(),
      shipping_country: String(body.shipping_country || "").trim(),
      thumb_drive_tier: tierDrive(String(body.plan_tier || "core")),
      updated_at: new Date().toISOString(),
    };

    const existing = await readProfile(user.org_id, user.user_id);
    if (existing?.id) {
      await q(
        `update app_records
            set title=$1, payload=$2::jsonb, updated_at=now()
          where id=$3 and org_id=$4`,
        ["SkyeVault Profile", JSON.stringify(profile), existing.id, user.org_id]
      );
    } else {
      await q(
        `insert into app_records(org_id, ws_id, app, title, payload, created_by)
         values($1,$2,$3,$4,$5::jsonb,$6)`,
        [user.org_id, null, APP_KEY, "SkyeVault Profile", JSON.stringify(profile), user.user_id]
      );
    }

    await audit(user.email, user.org_id, null, "vault.profile.saved", {
      plan_tier: profile.plan_tier,
      thumb_drive_tier: profile.thumb_drive_tier,
    });

    return json(200, { ok: true, profile, backend: "app_records" });
  }

  return json(405, { error: "Method not allowed." });
};