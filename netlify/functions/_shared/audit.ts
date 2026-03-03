import { q } from "./neon";

/**
 * Record an audit event in the database.  All consequential
 * operations should emit an audit event with actor, org, workspace,
 * type and arbitrary metadata.  Errors are swallowed silently
 * because audit logging must never break user flows.
 */
export async function audit(
  actor: string,
  org_id: string | null,
  ws_id: string | null,
  type: string,
  meta: any
) {
  try {
    await q(
      "insert into audit_events(actor, org_id, ws_id, type, meta) values($1,$2,$3,$4,$5::jsonb)",
      [actor, org_id, ws_id, type, JSON.stringify(meta ?? {})]
    );
  } catch (_) {
    // ignore audit failures
  }
}