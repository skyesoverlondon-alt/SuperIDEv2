import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { normalizeSknorePatterns } from "./_shared/sknore";

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

  const scope = String(body.scope || "org").trim().toLowerCase();
  const wsId = String(body.ws_id || "").trim();
  const rawPatterns = Array.isArray(body.patterns) ? body.patterns : [];
  const patterns = normalizeSknorePatterns(rawPatterns.map((p: any) => String(p || "")));

  if (scope !== "org" && scope !== "workspace") {
    return json(400, { error: "scope must be org or workspace." });
  }
  if (scope === "workspace" && !wsId) {
    return json(400, { error: "ws_id is required for workspace scope." });
  }

  const targetWs = scope === "workspace" ? wsId : null;

  const existing = await q(
    `select id
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ((ws_id is null and $2::uuid is null) or ws_id=$2::uuid)
     order by updated_at desc
     limit 1`,
    [u.org_id, targetWs || null]
  );

  let recordId = "";
  if (existing.rows.length) {
    const saved = await q(
      `update app_records
       set title=$1, payload=$2::jsonb, updated_at=now()
       where id=$3 and org_id=$4
       returning id`,
      [scope === "workspace" ? `SKNore Policy (${wsId})` : "SKNore Policy (org)", JSON.stringify({ patterns }), existing.rows[0].id, u.org_id]
    );
    recordId = String(saved.rows[0]?.id || existing.rows[0].id || "");
  } else {
    const created = await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       values($1,$2,'SKNorePolicy',$3,$4::jsonb,$5)
       returning id`,
      [u.org_id, targetWs, scope === "workspace" ? `SKNore Policy (${wsId})` : "SKNore Policy (org)", JSON.stringify({ patterns }), u.user_id]
    );
    recordId = String(created.rows[0]?.id || "");
  }

  await audit(u.email, u.org_id, targetWs, "sknore.policy.set", {
    scope,
    ws_id: targetWs,
    patterns_count: patterns.length,
    record_id: recordId || null,
  });

  return json(200, {
    ok: true,
    scope,
    ws_id: targetWs,
    patterns,
    record_id: recordId || null,
  });
};
