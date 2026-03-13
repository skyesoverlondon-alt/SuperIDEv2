import { q } from "./neon";

export type BrainUsageSnapshot = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  exact: boolean;
  source: "provider" | "estimated";
};

export async function recordBrainUsage(meta: {
  actor: string;
  actor_email?: string | null;
  actor_user_id?: string | null;
  org_id?: string | null;
  ws_id?: string | null;
  app: string;
  auth_type?: string | null;
  api_token_id?: string | null;
  api_token_label?: string | null;
  api_token_locked_email?: string | null;
  used_backup: boolean;
  brain_route: "primary" | "backup";
  provider?: string | null;
  model?: string | null;
  gateway_request_id?: string | null;
  backup_request_id?: string | null;
  gateway_status?: number | null;
  backup_status?: number | null;
  usage: BrainUsageSnapshot;
  billing?: Record<string, unknown>;
  success?: boolean;
}) {
  try {
    await q(
      `insert into ai_brain_usage_log(
        actor,
        actor_email,
        actor_user_id,
        org_id,
        ws_id,
        app,
        auth_type,
        api_token_id,
        api_token_label,
        api_token_locked_email,
        used_backup,
        brain_route,
        provider,
        model,
        gateway_request_id,
        backup_request_id,
        gateway_status,
        backup_status,
        usage_json,
        billing_json,
        success
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21
      )`,
      [
        meta.actor,
        meta.actor_email || null,
        meta.actor_user_id || null,
        meta.org_id || null,
        meta.ws_id || null,
        meta.app,
        meta.auth_type || "unknown",
        meta.api_token_id || null,
        meta.api_token_label || null,
        meta.api_token_locked_email || null,
        Boolean(meta.used_backup),
        meta.brain_route,
        meta.provider || null,
        meta.model || null,
        meta.gateway_request_id || null,
        meta.backup_request_id || null,
        meta.gateway_status ?? null,
        meta.backup_status ?? null,
        JSON.stringify(meta.usage || {}),
        JSON.stringify(meta.billing || {}),
        meta.success !== false,
      ]
    );
  } catch {
    // Usage logging must not block user flows.
  }
}