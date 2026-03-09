import crypto from "crypto";
import { q } from "./neon";

export type SovereignEventSeverity = "info" | "warning" | "error" | "critical";

type EmitSovereignEventInput = {
  actor: string;
  actorUserId?: string | null;
  orgId: string;
  wsId?: string | null;
  missionId?: string | null;
  eventType: string;
  sourceApp?: string | null;
  sourceRoute?: string | null;
  subjectKind?: string | null;
  subjectId?: string | null;
  parentEventId?: string | null;
  severity?: SovereignEventSeverity;
  summary?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
};

function inferEventFamily(eventType: string) {
  const normalized = String(eventType || "").trim().toLowerCase();
  const dot = normalized.indexOf(".");
  return dot === -1 ? normalized : normalized.slice(0, dot);
}

function buildInternalSignature(secret: string, parts: Record<string, unknown>) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(JSON.stringify(parts));
  return hmac.digest("base64url");
}

export async function emitSovereignEvent(input: EmitSovereignEventInput) {
  const eventType = String(input.eventType || "").trim().toLowerCase();
  if (!input.orgId || !eventType || !input.actor) return null;

  try {
    if (input.idempotencyKey) {
      const existing = await q(
        `select id, occurred_at
         from sovereign_events
         where org_id=$1
           and event_type=$2
           and ws_id is not distinct from $3
           and idempotency_key=$4
         order by occurred_at desc
         limit 1`,
        [input.orgId, eventType, input.wsId || null, input.idempotencyKey]
      );
      if (existing.rows.length) {
        return {
          id: existing.rows[0]?.id || null,
          occurred_at: existing.rows[0]?.occurred_at || null,
          duplicate: true,
        };
      }
    }

    const payload = input.payload ?? {};
    const summary = String(input.summary || "").trim() || null;
    const occurredAt = new Date().toISOString();
    const secret = String(process.env.RUNNER_SHARED_SECRET || "").trim();
    const internalSignature = secret
      ? buildInternalSignature(secret, {
          actor: input.actor,
          org_id: input.orgId,
          ws_id: input.wsId || null,
          event_type: eventType,
          occurred_at: occurredAt,
          payload,
        })
      : null;

    const inserted = await q(
      `insert into sovereign_events(
         occurred_at, org_id, ws_id, mission_id, event_type, event_family,
         source_app, source_route, actor, actor_user_id, subject_kind, subject_id,
         parent_event_id, severity, correlation_id, idempotency_key, internal_signature,
         summary, payload
       )
       values(
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,
         $18,$19::jsonb
       )
       returning id, occurred_at`,
      [
        occurredAt,
        input.orgId,
        input.wsId || null,
        input.missionId || null,
        eventType,
        inferEventFamily(eventType),
        input.sourceApp || null,
        input.sourceRoute || null,
        input.actor,
        input.actorUserId || null,
        input.subjectKind || null,
        input.subjectId || null,
        input.parentEventId || null,
        input.severity || "info",
        input.correlationId || null,
        input.idempotencyKey || null,
        internalSignature,
        summary,
        JSON.stringify(payload),
      ]
    );

    const eventId = inserted.rows[0]?.id || null;
    if (eventId) {
      try {
        await q(
          `insert into timeline_entries(
             at, org_id, ws_id, mission_id, event_id, entry_type, source_app,
             actor, actor_user_id, subject_kind, subject_id, title, summary, detail
           )
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            occurredAt,
            input.orgId,
            input.wsId || null,
            input.missionId || null,
            eventId,
            eventType,
            input.sourceApp || null,
            input.actor,
            input.actorUserId || null,
            input.subjectKind || null,
            input.subjectId || null,
            summary || eventType,
            summary,
            JSON.stringify(payload),
          ]
        );
      } catch {
        // Timeline fanout must not break the originating action.
      }
    }

    return {
      id: eventId,
      occurred_at: inserted.rows[0]?.occurred_at || occurredAt,
      duplicate: false,
    };
  } catch {
    return null;
  }
}