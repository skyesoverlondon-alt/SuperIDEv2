import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { canWriteWorkspace } from "./_shared/rbac";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
  }

  const wsId = String(body.ws_id || "").trim();
  const recordId = String(body.record_id || "").trim();
  const expectedUpdatedAt = String(body.expected_updated_at || "").trim();
  const title = String(body.title || "SkyeSlides Deck").trim();
  const model = body.model;

  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!model || typeof model !== "object") return json(400, { error: "Missing model payload." });

  const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace write denied." });

  try {
    let saved: any;

    if (recordId) {
      saved = await q(
        `update app_records
         set title=$1, payload=$2::jsonb, updated_at=now()
         where id=$3 and org_id=$4 and app='SkyeSlides'
           and ($5::timestamptz is null or updated_at = $5::timestamptz)
         returning id, updated_at`,
        [title, JSON.stringify(model), recordId, u.org_id, expectedUpdatedAt || null]
      );
      if (!saved.rows.length) {
        const current = await q(
          `select id, updated_at from app_records where id=$1 and org_id=$2 and app='SkyeSlides' limit 1`,
          [recordId, u.org_id]
        );
        if (!current.rows.length) return json(404, { error: "SkyeSlides record not found." });
        return json(409, {
          error: "SkyeSlides conflict: record changed by another editor.",
          conflict: true,
          current_record_id: current.rows[0].id,
          current_updated_at: current.rows[0].updated_at,
        });
      }
    } else {
      const existing = await q(
        `select id, updated_at
         from app_records
         where org_id=$1 and app='SkyeSlides' and ws_id=$2
         order by updated_at desc
         limit 1`,
        [u.org_id, wsId]
      );

      if (existing.rows.length) {
        if (!expectedUpdatedAt || String(existing.rows[0].updated_at) !== expectedUpdatedAt) {
          return json(409, {
            error: "SkyeSlides conflict: sync latest workspace model before saving.",
            conflict: true,
            current_record_id: existing.rows[0].id,
            current_updated_at: existing.rows[0].updated_at,
          });
        }
        saved = await q(
          `update app_records
           set title=$1, payload=$2::jsonb, updated_at=now()
           where id=$3 and updated_at=$4::timestamptz
           returning id, updated_at`,
          [title, JSON.stringify(model), existing.rows[0].id, expectedUpdatedAt]
        );
        if (!saved.rows.length) {
          const current = await q(
            `select id, updated_at from app_records where id=$1 and org_id=$2 and app='SkyeSlides' limit 1`,
            [existing.rows[0].id, u.org_id]
          );
          return json(409, {
            error: "SkyeSlides conflict: record changed by another editor.",
            conflict: true,
            current_record_id: current.rows[0]?.id || existing.rows[0].id,
            current_updated_at: current.rows[0]?.updated_at || existing.rows[0].updated_at,
          });
        }
      } else {
        saved = await q(
          `insert into app_records(org_id, ws_id, app, title, payload, created_by)
           values($1,$2,'SkyeSlides',$3,$4::jsonb,$5)
           returning id, updated_at`,
          [u.org_id, wsId, title, JSON.stringify(model), u.user_id]
        );
      }
    }

    await audit(u.email, u.org_id, wsId, "skyeslides.save.ok", {
      record_id: saved.rows[0]?.id || null,
      title,
    });

    return json(200, { ok: true, record_id: saved.rows[0]?.id || null, updated_at: saved.rows[0]?.updated_at || null });
  } catch (e: any) {
    const msg = e?.message || "SkyeSlides save failed.";
    await audit(u.email, u.org_id, wsId, "skyeslides.save.failed", { error: msg });
    return json(500, { error: msg });
  }
};
