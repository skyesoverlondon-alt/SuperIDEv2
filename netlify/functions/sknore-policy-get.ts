import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  const params = event?.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();

  const scoped = wsId
    ? await q(
        `select id, ws_id, payload, updated_at
         from app_records
         where org_id=$1 and app='SKNorePolicy' and ws_id=$2
         order by updated_at desc
         limit 1`,
        [u.org_id, wsId]
      )
    : { rows: [] as any[] };

  if (scoped.rows.length) {
    const rec = scoped.rows[0];
    const payload = rec.payload || {};
    return json(200, {
      ok: true,
      scope: "workspace",
      ws_id: rec.ws_id,
      patterns: Array.isArray(payload.patterns) ? payload.patterns : [],
      updated_at: rec.updated_at || null,
    });
  }

  const orgWide = await q(
    `select id, ws_id, payload, updated_at
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ws_id is null
     order by updated_at desc
     limit 1`,
    [u.org_id]
  );

  if (!orgWide.rows.length) {
    return json(200, {
      ok: true,
      scope: wsId ? "workspace" : "org",
      ws_id: wsId || null,
      patterns: [],
      updated_at: null,
    });
  }

  const rec = orgWide.rows[0];
  const payload = rec.payload || {};
  return json(200, {
    ok: true,
    scope: "org",
    ws_id: null,
    patterns: Array.isArray(payload.patterns) ? payload.patterns : [],
    updated_at: rec.updated_at || null,
  });
};
