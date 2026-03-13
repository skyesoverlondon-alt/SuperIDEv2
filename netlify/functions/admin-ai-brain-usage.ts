import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { getOrgRole } from "./_shared/rbac";

function parseLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function schemaMissing(error: unknown) {
  const text = String((error as any)?.message || error || "").toLowerCase();
  return text.includes("ai_brain_usage_log") && (text.includes("does not exist") || text.includes("undefined_table"));
}

export const handler = async (event: any) => {
  const user = await requireUser(event);
  if (!user) return forbid();
  if (!user.org_id) return json(400, { error: "User has no org." });

  const role = await getOrgRole(user.org_id, user.user_id);
  if (role !== "owner" && role !== "admin") {
    return json(403, { error: "Forbidden: owner/admin role required." });
  }

  const params = event.queryStringParameters || {};
  const wsId = String(params.ws_id || "").trim();
  const app = String(params.app || "").trim();
  const actor = String(params.actor || "").trim();
  const route = String(params.route || "").trim().toLowerCase();
  const before = String(params.before || "").trim();
  const usedBackupParam = String(params.used_backup || "").trim().toLowerCase();
  const limit = parseLimit(params.limit, 50, 200);

  const clauses = ["org_id=$1"];
  const values: any[] = [user.org_id];
  let idx = 2;

  if (wsId) {
    clauses.push(`ws_id=$${idx++}`);
    values.push(wsId);
  }
  if (app) {
    clauses.push(`app=$${idx++}`);
    values.push(app);
  }
  if (actor) {
    clauses.push(`(actor ilike $${idx} or actor_email ilike $${idx})`);
    values.push(`%${actor}%`);
    idx += 1;
  }
  if (route === "primary" || route === "backup") {
    clauses.push(`brain_route=$${idx++}`);
    values.push(route);
  }
  if (usedBackupParam === "true" || usedBackupParam === "false") {
    clauses.push(`used_backup=$${idx++}`);
    values.push(usedBackupParam === "true");
  }
  if (before) {
    clauses.push(`at < $${idx++}`);
    values.push(before);
  }

  const where = clauses.join(" and ");

  try {
    const summary = await q(
      `select count(*)::int as total_requests,
              coalesce(sum(case when used_backup then 1 else 0 end), 0)::int as backup_requests,
              coalesce(sum(case when success then 1 else 0 end), 0)::int as successful_requests,
              coalesce(sum(case when usage_json->>'prompt_tokens' ~ '^\\d+$' then (usage_json->>'prompt_tokens')::bigint else 0 end), 0)::bigint as prompt_tokens,
              coalesce(sum(case when usage_json->>'completion_tokens' ~ '^\\d+$' then (usage_json->>'completion_tokens')::bigint else 0 end), 0)::bigint as completion_tokens,
              coalesce(sum(case when usage_json->>'total_tokens' ~ '^\\d+$' then (usage_json->>'total_tokens')::bigint else 0 end), 0)::bigint as total_tokens,
              max(at) as latest_at
         from ai_brain_usage_log
        where ${where}`,
      values
    );

    const appBreakdown = await q(
      `select app,
              count(*)::int as requests,
              coalesce(sum(case when used_backup then 1 else 0 end), 0)::int as backup_requests,
              coalesce(sum(case when usage_json->>'total_tokens' ~ '^\\d+$' then (usage_json->>'total_tokens')::bigint else 0 end), 0)::bigint as total_tokens
         from ai_brain_usage_log
        where ${where}
        group by app
        order by requests desc, app asc
        limit 20`,
      values
    );

    const actorBreakdown = await q(
      `select coalesce(nullif(actor_email, ''), actor) as actor,
              count(*)::int as requests,
              coalesce(sum(case when used_backup then 1 else 0 end), 0)::int as backup_requests,
              coalesce(sum(case when usage_json->>'total_tokens' ~ '^\\d+$' then (usage_json->>'total_tokens')::bigint else 0 end), 0)::bigint as total_tokens
         from ai_brain_usage_log
        where ${where}
        group by coalesce(nullif(actor_email, ''), actor)
        order by requests desc, actor asc
        limit 20`,
      values
    );

    const itemValues = [...values, limit];
    const items = await q(
      `select id, at, actor, actor_email, actor_user_id, ws_id, app, auth_type,
              api_token_id, api_token_label, api_token_locked_email,
              used_backup, brain_route, provider, model,
              gateway_request_id, backup_request_id, gateway_status, backup_status,
              usage_json, billing_json, success
         from ai_brain_usage_log
        where ${where}
        order by at desc
        limit $${idx}`,
      itemValues
    );

    return json(200, {
      ok: true,
      filters: {
        ws_id: wsId || null,
        app: app || null,
        actor: actor || null,
        route: route || null,
        used_backup: usedBackupParam === "true" ? true : usedBackupParam === "false" ? false : null,
        before: before || null,
        limit,
      },
      summary: summary.rows[0] || null,
      breakdowns: {
        apps: appBreakdown.rows,
        actors: actorBreakdown.rows,
      },
      items: items.rows,
    });
  } catch (error) {
    if (schemaMissing(error)) {
      return json(500, {
        error: "ai_brain_usage_log is missing in the active Neon database. Apply db/schema.sql to the same database pointed to by NEON_DATABASE_URL.",
      });
    }
    return json(500, { error: String((error as any)?.message || "AI usage report failed.") });
  }
};