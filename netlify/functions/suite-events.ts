import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { canReadWorkspace, canWriteWorkspace } from "./_shared/rbac";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { readCorrelationId } from "./_shared/correlation";
import { readIdempotencyKey } from "./_shared/idempotency";
import { emitSovereignEvent } from "./_shared/sovereign-events";

type SuiteIntentStatus = "requested" | "queued" | "completed" | "failed";

type SuiteContext = {
  workspace_id: string;
  file_ids?: string[];
  thread_id?: string | null;
  channel_id?: string | null;
  mission_id?: string | null;
  draft_id?: string | null;
  case_id?: string | null;
  asset_ids?: string[];
  [key: string]: unknown;
};

type SuiteIntent = {
  name: string;
  version: "suite-intent-v1";
  status: SuiteIntentStatus;
  summary?: string | null;
};

type SuiteRecommendation = {
  source_app: string;
  target_app: string;
  intent: SuiteIntent;
  context: SuiteContext;
  detail: string;
};

function parseLimit(raw: string | undefined): number {
  const n = Number(raw || 40);
  if (!Number.isFinite(n)) return 40;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100);
}

function normalizeStatus(raw: unknown): SuiteIntentStatus {
  const value = String(raw || "requested").trim().toLowerCase();
  if (value === "queued" || value === "completed" || value === "failed") return value;
  return "requested";
}

function normalizeIntent(raw: unknown): SuiteIntent {
  const input = typeof raw === "string" ? { name: raw } : asRecord(raw);
  const name = String(input.name || "open-proof").trim().toLowerCase();
  return {
    name: name || "open-proof",
    version: "suite-intent-v1",
    status: normalizeStatus(input.status),
    summary: input.summary ? String(input.summary).trim() : null,
  };
}

function normalizeContext(raw: unknown, wsId: string): SuiteContext {
  const input = asRecord(raw);
  return {
    workspace_id: String(input.workspace_id || input.workspaceId || wsId).trim() || wsId,
    file_ids: asStringList(input.file_ids || input.fileIds),
    thread_id: input.thread_id ? String(input.thread_id).trim() : input.threadId ? String(input.threadId).trim() : null,
    channel_id: input.channel_id ? String(input.channel_id).trim() : input.channelId ? String(input.channelId).trim() : null,
    mission_id: input.mission_id ? String(input.mission_id).trim() : input.missionId ? String(input.missionId).trim() : null,
    draft_id: input.draft_id ? String(input.draft_id).trim() : input.draftId ? String(input.draftId).trim() : null,
    case_id: input.case_id ? String(input.case_id).trim() : input.caseId ? String(input.caseId).trim() : null,
    asset_ids: asStringList(input.asset_ids || input.assetIds),
  };
}

function buildSummary(sourceApp: string, targetApp: string | null, intent: SuiteIntent, detail: string) {
  if (detail) return detail;
  if (targetApp) return `${sourceApp} ${intent.status} ${intent.name} -> ${targetApp}`;
  return `${sourceApp} ${intent.status} ${intent.name}`;
}

function normalizeEventRow(row: any) {
  const payload = asRecord(row?.payload);
  return {
    id: String(row?.id || ""),
    occurred_at: row?.occurred_at || row?.at || null,
    source_app: String(row?.source_app || payload.source_app || "").trim(),
    target_app: String(payload.target_app || "").trim() || null,
    summary: String(row?.summary || payload.detail || "").trim(),
    correlation_id: row?.correlation_id || null,
    idempotency_key: row?.idempotency_key || null,
    intent: normalizeIntent(payload.intent),
    context: normalizeContext(payload.context, String(row?.ws_id || payload.ws_id || "").trim()),
    detail: String(payload.detail || row?.summary || "").trim(),
    payload,
  };
}

function deriveAutomations(event: {
  sourceApp: string;
  targetApp: string | null;
  intent: SuiteIntent;
  context: SuiteContext;
}): SuiteRecommendation[] {
  if (event.intent.status !== "completed" || !event.targetApp) return [];
  const baseContext = event.context;

  if (event.sourceApp === "SkyeDocxPro" && event.targetApp === "SkyeMail" && event.intent.name === "compose-mail") {
    return [
      {
        source_app: "SkyeMail",
        target_app: "SkyeChat",
        intent: { name: "open-thread", version: "suite-intent-v1", status: "queued", summary: "Carry the document follow-up into the command room." },
        context: { ...baseContext, channel_id: baseContext.channel_id || "docx-review" },
        detail: "Automation queued: SkyeMail follow-up thread for the document handoff.",
      },
    ];
  }

  if (event.sourceApp === "SkyDex4.6" && event.targetApp === "SovereignVariables" && event.intent.name === "sync-case") {
    return [
      {
        source_app: "SovereignVariables",
        target_app: "SkyeAnalytics",
        intent: { name: "open-proof", version: "suite-intent-v1", status: "queued", summary: "Open proof and telemetry after environment sync." },
        context: baseContext,
        detail: "Automation queued: review suite proof in SkyeAnalytics after the SkyDex sync.",
      },
    ];
  }

  if (event.sourceApp === "AE-Flow" && event.targetApp === "SkyeMail" && event.intent.name === "compose-mail") {
    return [
      {
        source_app: "SkyeMail",
        target_app: "SkyeAdmin",
        intent: { name: "escalate-admin", version: "suite-intent-v1", status: "queued", summary: "Escalate the AE handoff to admin review." },
        context: baseContext,
        detail: "Automation queued: AE handoff escalated into SkyeAdmin.",
      },
    ];
  }

  if (event.sourceApp === "GoogleBusinessProfileRescuePlatform" && event.targetApp === "Neural-Space-Pro" && event.intent.name === "launch-neural") {
    return [
      {
        source_app: "Neural-Space-Pro",
        target_app: "SkyeMail",
        intent: { name: "compose-mail", version: "suite-intent-v1", status: "queued", summary: "Draft the external rescue follow-up in mail." },
        context: baseContext,
        detail: "Automation queued: rescue follow-up draft in SkyeMail.",
      },
    ];
  }

  if (event.sourceApp === "Neural-Space-Pro" && event.targetApp === "SkyeMail" && event.intent.name === "compose-mail") {
    return [
      {
        source_app: "SkyeMail",
        target_app: "SkyeChat",
        intent: { name: "open-thread", version: "suite-intent-v1", status: "queued", summary: "Move the rescue execution into the team room." },
        context: { ...baseContext, channel_id: baseContext.channel_id || "rescue-ops" },
        detail: "Automation queued: rescue execution thread in SkyeChat.",
      },
    ];
  }

  return [];
}

async function writeSuiteEvent(options: {
  actor: string;
  actorUserId: string;
  orgId: string;
  wsId: string;
  sourceApp: string;
  targetApp: string | null;
  intent: SuiteIntent;
  context: SuiteContext;
  detail: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  idempotencyKey: string | null;
}) {
  const summary = buildSummary(options.sourceApp, options.targetApp, options.intent, options.detail);
  return emitSovereignEvent({
    actor: options.actor,
    actorUserId: options.actorUserId,
    orgId: options.orgId,
    wsId: options.wsId,
    missionId: options.context.mission_id || null,
    eventType: `suite.intent.${options.intent.status}`,
    sourceApp: options.sourceApp,
    sourceRoute: "/api/suite-events",
    subjectKind: "suite_intent",
    subjectId: `${options.sourceApp}:${options.intent.name}:${options.targetApp || "none"}`,
    severity: options.intent.status === "failed" ? "warning" : "info",
    summary,
    correlationId: options.correlationId,
    idempotencyKey: options.idempotencyKey,
    payload: {
      bridge_schema: "suite-intent-v1",
      source_app: options.sourceApp,
      target_app: options.targetApp,
      intent: options.intent,
      context: options.context,
      detail: options.detail,
      ...options.payload,
    },
  });
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  if (event.httpMethod === "GET") {
    const params = event?.queryStringParameters || {};
    const wsId = String(params.ws_id || "").trim();
    const appId = String(params.app_id || "").trim();
    const limit = parseLimit(params.limit);

    if (!wsId) return json(400, { error: "Missing ws_id." });
    const allowed = await canReadWorkspace(u.org_id, u.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace read denied." });

    const values: any[] = [u.org_id, wsId, limit];
    let appFilterSql = "";
    if (appId) {
      values.splice(2, 0, appId);
      appFilterSql = " and (source_app=$3 or payload->>'target_app'=$3)";
    }

    const rows = await q(
      `select id, occurred_at, ws_id, source_app, summary, correlation_id, idempotency_key, payload
       from sovereign_events
       where org_id=$1
         and ws_id=$2
         and event_type like 'suite.intent.%'${appFilterSql}
       order by occurred_at desc
       limit $${appId ? 4 : 3}`,
      values
    );

    const items = rows.rows.map(normalizeEventRow);
    return json(200, { ok: true, items });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const wsId = String(body.ws_id || "").trim();
  const sourceApp = String(body.source_app || body.sourceApp || "").trim();
  const targetAppRaw = String(body.target_app || body.targetApp || "").trim();
  const targetApp = targetAppRaw || null;
  const intent = normalizeIntent(body.intent);
  const context = normalizeContext(body.context, wsId);
  const detail = String(body.detail || body.note || intent.summary || "").trim();
  const correlationId = readCorrelationId(event) || (body.correlation_id ? String(body.correlation_id).trim() : null);
  const idempotencyKey = readIdempotencyKey(event, body) || (body.idempotency_key ? String(body.idempotency_key).trim() : null);
  const extraPayload = asRecord(body.payload);

  if (!wsId) return json(400, { error: "Missing ws_id." });
  if (!sourceApp) return json(400, { error: "Missing source_app." });
  if (!intent.name) return json(400, { error: "Missing intent name." });

  const allowed = await canWriteWorkspace(u.org_id, u.user_id, wsId);
  if (!allowed) return json(403, { error: "Workspace write denied." });

  const saved = await writeSuiteEvent({
    actor: u.email,
    actorUserId: u.user_id,
    orgId: u.org_id,
    wsId,
    sourceApp,
    targetApp,
    intent,
    context,
    detail,
    payload: extraPayload,
    correlationId,
    idempotencyKey,
  });

  const recommendations = deriveAutomations({ sourceApp, targetApp, intent, context });

  for (let index = 0; index < recommendations.length; index += 1) {
    const recommendation = recommendations[index];
    await writeSuiteEvent({
      actor: u.email,
      actorUserId: u.user_id,
      orgId: u.org_id,
      wsId,
      sourceApp: recommendation.source_app,
      targetApp: recommendation.target_app,
      intent: recommendation.intent,
      context: recommendation.context,
      detail: recommendation.detail,
      payload: {
        automation: {
          derived: true,
          source_event_id: saved?.id || null,
        },
      },
      correlationId,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:automation:${index}` : null,
    });
  }

  await audit(u.email, u.org_id, wsId, "suite.event.save", {
    source_app: sourceApp,
    target_app: targetApp,
    intent,
    context,
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    event_id: saved?.id || null,
    recommendations: recommendations.length,
  });

  return json(200, {
    ok: true,
    item: {
      id: saved?.id || null,
      occurred_at: saved?.occurred_at || null,
      source_app: sourceApp,
      target_app: targetApp,
      intent,
      context,
      detail,
    },
    recommendations,
  });
};