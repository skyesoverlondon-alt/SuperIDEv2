import { ensureSchema, sql } from './_lib/db.js';
import { json, noContent, unauthorized, serverError } from './_lib/http.js';
import { verifyAdminSession } from './_lib/admin.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const token = event.headers['x-admin-session'] || event.headers['X-Admin-Session'];
    const check = verifyAdminSession(token);
    if (!check.ok) return unauthorized(`Admin session rejected: ${check.reason}`);

    await ensureSchema();

    const [users, events, sheets, threads, userCount, sheetCount, leadCount] = await Promise.all([
      sql`SELECT identity_uid, email, full_name, first_seen_at, last_seen_at FROM app_users ORDER BY last_seen_at DESC LIMIT 20`,
      sql`SELECT id, actor_identity_uid, event_type, summary, payload, created_at FROM audit_events ORDER BY created_at DESC LIMIT 40`,
      sql`SELECT id, title, row_count, source_summary, created_at, updated_at FROM sheets ORDER BY updated_at DESC LIMIT 20`,
      sql`SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC LIMIT 20`,
      sql`SELECT COUNT(*)::int AS count FROM app_users`,
      sql`SELECT COUNT(*)::int AS count FROM sheets`,
      sql`SELECT COUNT(*)::int AS count FROM leads`
    ]);

    return json(200, {
      ok: true,
      actor: check.payload.actor,
      metrics: {
        users: userCount[0]?.count || 0,
        sheets: sheetCount[0]?.count || 0,
        leads: leadCount[0]?.count || 0
      },
      users,
      events,
      sheets,
      threads
    });
  } catch (error) {
    return serverError(error);
  }
};
