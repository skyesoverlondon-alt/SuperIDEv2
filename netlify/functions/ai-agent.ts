import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { opt } from "./_shared/env";
import { canReadWorkspace } from "./_shared/rbac";
import {
  hasValidMasterSequence,
  readBearerToken,
  resolveApiToken,
  tokenHasScope,
} from "./_shared/api_tokens";
import {
  filterSknoreFiles,
  isSknoreProtected,
  loadSknorePolicy,
} from "./_shared/sknore";
import { callKaixuBrainWithFailover } from "./_shared/kaixu_brain";
import { recordBrainUsage } from "./_shared/brain_usage";
import {
  applyOperationsToWorkspace,
  buildProjectMap,
  buildSeedContext,
  normalizeWorkspaceFiles,
  sanitizeOperations,
  summarizeWorkspace,
  type AgentOperation,
  type AgentWorkspaceFile,
} from "./_shared/agent_workspace";

type AgentMode = "plan" | "execute";
type AgentAutonomy = "controlled" | "autonomous";

type StructuredAgentReply = {
  summary: string;
  changes: string[];
  risks: string[];
  next: string;
  done: boolean;
  operations: AgentOperation[];
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeMode(input: unknown): AgentMode {
  return String(input || "").trim().toLowerCase() === "plan" ? "plan" : "execute";
}

function normalizeAutonomy(input: unknown): AgentAutonomy {
  return String(input || "").trim().toLowerCase() === "autonomous" ? "autonomous" : "controlled";
}

function extractJsonPayload(raw: string): any | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const directCandidates = [text];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) directCandidates.push(fenced[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    directCandidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  return null;
}

function normalizeStructuredReply(rawText: string, payload: any): StructuredAgentReply {
  const summary = String(payload?.summary || payload?.message || rawText || "No summary provided.")
    .replace(/\s+/g, " ")
    .trim();
  const changes = Array.isArray(payload?.changes)
    ? payload.changes.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : [];
  const risks = Array.isArray(payload?.risks)
    ? payload.risks.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : [];
  const next = String(payload?.next || "Review the staged operations and run validation before shipping.")
    .replace(/\s+/g, " ")
    .trim();
  return {
    summary: summary || "No summary provided.",
    changes,
    risks,
    next,
    done: Boolean(payload?.done),
    operations: sanitizeOperations(payload?.operations),
  };
}

function formatReply(reply: StructuredAgentReply): string {
  const lines = [
    "SUMMARY:",
    `- ${reply.summary}`,
    "",
    "CHANGES:",
    ...(reply.changes.length ? reply.changes.map((item) => `- ${item}`) : ["- No explicit file list was returned."]),
    "",
    "RISKS:",
    ...(reply.risks.length ? reply.risks.map((item) => `- ${item}`) : ["- none obvious"]),
    "",
    "NEXT:",
    `- ${reply.next}`,
  ];
  return lines.join("\n");
}

function summarizeOperations(operations: AgentOperation[]): Record<string, number> {
  return operations.reduce<Record<string, number>>((acc, operation) => {
    acc[operation.type] = (acc[operation.type] || 0) + 1;
    return acc;
  }, {});
}

function buildSystemPrompt({
  mode,
  autonomy,
  workspaceName,
  agentMemory,
  activePath,
  projectMap,
  workspaceSummary,
  seededFiles,
  iteration,
  maxIterations,
}: {
  mode: AgentMode;
  autonomy: AgentAutonomy;
  workspaceName: string;
  agentMemory: string;
  activePath: string;
  projectMap: string;
  workspaceSummary: string;
  seededFiles: string[];
  iteration: number;
  maxIterations: number;
}): string {
  return [
    "You are kAIx4nthi4 4.6 operating as the autonomous SkyDex coding agent.",
    "Respond with JSON only. Do not wrap it in markdown fences.",
    "Respect the current workspace structure and preserve behavior unless the task explicitly asks for changes.",
    mode === "plan"
      ? "You are in PLAN mode. Propose preview operations only; they will not be applied yet."
      : autonomy === "autonomous"
        ? "You are in EXECUTE mode with autonomous iteration. Return the next concrete full-file operations needed for this iteration."
        : "You are in EXECUTE mode with controlled iteration. Return only the next concrete full-file operations for a single pass.",
    "Every create or update operation must contain the COMPLETE file content.",
    "Allowed operation types: create, update, delete, rename.",
    "If no file changes are needed, return an empty operations array and done=true.",
    "Output schema:",
    '{"summary":"string","changes":["string"],"risks":["string"],"next":"string","done":true,"operations":[{"type":"update","path":"src/file.ts","content":"full file content"}]}',
    `workspace_name: ${workspaceName}`,
    `workspace_summary: ${workspaceSummary}`,
    `active_path: ${activePath || "none"}`,
    `iteration: ${iteration}/${maxIterations}`,
    seededFiles.length ? `seeded_files: ${seededFiles.join(" | ")}` : "seeded_files: none",
    agentMemory ? `workspace_conventions: ${agentMemory}` : "workspace_conventions: none",
    "project_map:",
    projectMap || "(empty workspace)",
  ].join("\n\n");
}

function buildUserPrompt({
  prompt,
  seedContext,
  priorReply,
  priorOperations,
}: {
  prompt: string;
  seedContext: string;
  priorReply: StructuredAgentReply | null;
  priorOperations: AgentOperation[];
}): string {
  const sections = [`TASK:\n${prompt}`];
  if (seedContext) sections.push(`HIGH_SIGNAL_CONTEXT:\n${seedContext}`);
  if (priorReply) {
    sections.push(`PREVIOUS_RESULT:\n${formatReply(priorReply)}`);
  }
  if (priorOperations.length) {
    sections.push(
      `OPERATIONS_ALREADY_STAGED:\n${priorOperations
        .map((operation) => {
          if (operation.type === "rename") return `- rename ${operation.from} -> ${operation.to}`;
          if (operation.type === "delete") return `- delete ${operation.path}`;
          return `- ${operation.type} ${operation.path}`;
        })
        .join("\n")}`
    );
  }
  return sections.join("\n\n");
}

export const handler = async (event: any) => {
  const user = await requireUser(event);
  const bearer = readBearerToken(event.headers || {});
  const tokenPrincipal = bearer ? await resolveApiToken(bearer) : null;
  if (!user && !tokenPrincipal) return forbid();

  const headers = event.headers || {};
  const tokenEmailHeader =
    String(headers["x-token-email"] || headers["X-Token-Email"] || "").trim().toLowerCase();
  const tokenMasterHeader =
    String(headers["x-token-master-sequence"] || headers["X-Token-Master-Sequence"] || "").trim();
  const tokenMasterExpected = opt("TOKEN_MASTER_SEQUENCE", "");
  const tokenMasterBypass = hasValidMasterSequence(tokenMasterHeader, tokenMasterExpected);

  if (tokenPrincipal?.locked_email && !tokenMasterBypass) {
    if (!tokenEmailHeader || tokenEmailHeader !== tokenPrincipal.locked_email.toLowerCase()) {
      return json(401, { error: "Token email lock mismatch." });
    }
  }

  if (tokenPrincipal && !tokenHasScope(tokenPrincipal.scopes, "generate")) {
    return json(403, { error: "Token missing required scope: generate" });
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const wsId = String(body.ws_id || "").trim();
  const prompt = String(body.prompt || "").trim();
  const activePath = String(body.activePath || "").trim();
  const mode = normalizeMode(body.mode);
  const autonomy = normalizeAutonomy(body.autonomy);
  const smartContext = body.smartContext !== false;
  const contextDepth = String(body.contextDepth || "balanced").trim().toLowerCase() === "light"
    ? "light"
    : String(body.contextDepth || "balanced").trim().toLowerCase() === "deep"
      ? "deep"
      : "balanced";
  const maxIterations = clamp(Number(body.max_iterations ?? body.maxIterations ?? (autonomy === "autonomous" ? 3 : 1)), 1, mode === "plan" ? 1 : 6);
  const operationBudget = clamp(Number(body.operationBudget || 24), 1, 96);
  const agentMemory = String(body.agentMemory || "").trim().slice(0, 4000);

  if (!wsId || !prompt) {
    return json(400, { error: "Missing ws_id or prompt." });
  }

  const workspaceResult = await q(
    "select id, org_id, name, files_json from workspaces where id=$1 limit 1",
    [wsId]
  );
  const workspace = workspaceResult.rows[0] || null;
  if (!workspace) return json(404, { error: "Workspace not found." });

  if (user?.org_id) {
    if (workspace.org_id !== user.org_id) return forbid();
    const allowed = await canReadWorkspace(user.org_id, user.user_id, wsId);
    if (!allowed) return json(403, { error: "Workspace read denied." });
  } else if (tokenPrincipal?.org_id) {
    if (workspace.org_id !== tokenPrincipal.org_id) {
      return json(403, { error: "Workspace access denied for token org." });
    }
  }

  const actorEmail = user?.email || `token:${tokenPrincipal?.label || tokenPrincipal?.id || "unknown"}`;
  const actorOrg = user?.org_id || tokenPrincipal?.org_id || null;

  const sknorePatterns = await loadSknorePolicy(actorOrg as string, wsId || null);
  if (activePath && isSknoreProtected(activePath, sknorePatterns)) {
    await audit(actorEmail, actorOrg, wsId, "skydex.agent.blocked_active_path", { activePath });
    return json(403, {
      error: `SKNore policy blocks active file: ${activePath}`,
      code: "SKNORE_BLOCKED_ACTIVE_PATH",
    });
  }

  const rawFiles = Array.isArray(body.files) && body.files.length ? body.files : workspace.files_json || [];
  const filteredFiles = filterSknoreFiles(rawFiles as Array<{ path: string }>, sknorePatterns);
  const initialFiles = normalizeWorkspaceFiles(filteredFiles);

  await audit(actorEmail, actorOrg, wsId, "skydex.agent.requested", {
    mode,
    autonomy,
    prompt_chars: prompt.length,
    files: initialFiles.length,
    smart_context: smartContext,
    context_depth: contextDepth,
    max_iterations: maxIterations,
    operation_budget: operationBudget,
  });

  let currentFiles: AgentWorkspaceFile[] = initialFiles;
  let stagedOperations: AgentOperation[] = [];
  let finalReply: StructuredAgentReply | null = null;
  let rawReply = "";
  let usedBrain: any = null;
  let usedUsage: any = null;
  let usedBilling: any = null;
  let usedGatewayStatus: number | null = null;
  let usedBackupStatus: number | null = null;
  let usedGatewayRequestId: string | null = null;
  let usedBackupRequestId: string | null = null;
  let seededFiles: string[] = [];
  const touched = new Set<string>();

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const workspaceSummary = summarizeWorkspace(currentFiles);
      const projectMap = buildProjectMap(currentFiles, contextDepth === "deep" ? 220 : 140);
      const seed = smartContext ? buildSeedContext(currentFiles, prompt, { depth: contextDepth as any }) : { selected: [], context: "" };
      if (!seededFiles.length) seededFiles = seed.selected;

      const result = await callKaixuBrainWithFailover({
        bodyModel: body.model,
        defaultModel: "kAIxU-Prime6.7",
        providerRaw: opt("KAIXU_GATEWAY_PROVIDER", "Skyes Over London"),
        messages: [
          {
            role: "system",
            content: buildSystemPrompt({
              mode,
              autonomy,
              workspaceName: String(workspace.name || "SkyDex Workspace"),
              agentMemory,
              activePath,
              projectMap,
              workspaceSummary,
              seededFiles: seed.selected,
              iteration,
              maxIterations,
            }),
          },
          {
            role: "user",
            content: buildUserPrompt({
              prompt,
              seedContext: seed.context,
              priorReply: finalReply,
              priorOperations: stagedOperations,
            }),
          },
        ],
        requestContext: {
          ws_id: wsId,
          activePath: activePath || null,
          app: "SkyDex4.6",
          actor_email: actorEmail,
          actor_org: actorOrg,
          actor_user_id: u?.user_id || null,
          auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
          api_token_id: tokenPrincipal?.id || null,
          api_token_label: tokenPrincipal?.label || null,
          api_token_locked_email: tokenPrincipal?.locked_email || null,
        },
      });

      if (!result.ok) {
        await audit(actorEmail, actorOrg, wsId, "skydex.agent.failed", {
          mode,
          autonomy,
          error: result.error,
          brain: result.brain,
          usage: result.usage,
          billing: result.billing,
        });
        return json(result.status, {
          ok: false,
          error: result.error,
          brain: result.brain,
          usage: result.usage,
          billing: result.billing,
        });
      }

      rawReply = result.text;
      usedBrain = result.brain;
  usedUsage = result.usage;
  usedBilling = result.billing;
  usedGatewayStatus = result.gateway_status;
  usedBackupStatus = result.backup_status;
  usedGatewayRequestId = result.gateway_request_id;
  usedBackupRequestId = result.backup_request_id;
      const payload = extractJsonPayload(result.text);
      finalReply = normalizeStructuredReply(result.text, payload || {});

      let nextOperations = finalReply.operations;
      const remainingBudget = Math.max(0, operationBudget - stagedOperations.length);
      if (remainingBudget === 0) nextOperations = [];
      if (nextOperations.length > remainingBudget) nextOperations = nextOperations.slice(0, remainingBudget);
      finalReply.operations = nextOperations;

      if (nextOperations.length) {
        stagedOperations = [...stagedOperations, ...nextOperations];
        for (const operation of nextOperations) {
          if (operation.type === "rename") {
            touched.add(operation.from);
            touched.add(operation.to);
          } else {
            touched.add(operation.path);
          }
        }
      }

      if (mode === "execute" && nextOperations.length) {
        currentFiles = applyOperationsToWorkspace(currentFiles, nextOperations).files;
      }

      const shouldStop =
        mode === "plan" ||
        autonomy === "controlled" ||
        finalReply.done ||
        nextOperations.length === 0 ||
        stagedOperations.length >= operationBudget;

      if (shouldStop) break;
    }

    const reply = finalReply || normalizeStructuredReply(rawReply, {});
    const operationCounts = summarizeOperations(stagedOperations);
    if (usedBrain) {
      await recordBrainUsage({
        actor: actorEmail,
        actor_email: actorEmail,
        actor_user_id: u?.user_id || null,
        org_id: actorOrg,
        ws_id: wsId,
        app: "SkyDex4.6",
        auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
        api_token_id: tokenPrincipal?.id || null,
        api_token_label: tokenPrincipal?.label || null,
        api_token_locked_email: tokenPrincipal?.locked_email || null,
        used_backup: usedBrain.route === "backup",
        brain_route: usedBrain.route,
        provider: usedBrain.provider,
        model: usedBrain.model,
        gateway_request_id: usedGatewayRequestId,
        backup_request_id: usedBackupRequestId,
        gateway_status: usedGatewayStatus,
        backup_status: usedBackupStatus,
        usage: usedUsage || { prompt_tokens: null, completion_tokens: null, total_tokens: null, exact: false, source: "estimated" },
        billing: usedBilling || {
          actor_email: actorEmail,
          actor_user_id: u?.user_id || null,
          auth_type: tokenPrincipal ? "api_token" : u ? "session" : "unknown",
          api_token_id: tokenPrincipal?.id || null,
          api_token_label: tokenPrincipal?.label || null,
          api_token_locked_email: tokenPrincipal?.locked_email || null,
        },
        success: true,
      });
    }
    await audit(actorEmail, actorOrg, wsId, "skydex.agent.ok", {
      mode,
      autonomy,
      operations: stagedOperations.length,
      touched: touched.size,
      brain: usedBrain,
      usage: usedUsage,
      billing: usedBilling,
      operation_counts: operationCounts,
    });

    return json(200, {
      ok: true,
      result: {
        reply: formatReply(reply),
        summary: reply.summary,
        operations: stagedOperations,
        touched: Array.from(touched),
        report: {
          mode,
          autonomy,
          smartContext,
          contextDepth,
          seededFiles,
          workspaceFiles: initialFiles.length,
          operationBudget,
          maxIterations,
          operationCounts,
          brain: usedBrain,
          usage: usedUsage,
          billing: usedBilling,
        },
      },
    });
  } catch (error: any) {
    await audit(actorEmail, actorOrg, wsId, "skydex.agent.failed", {
      mode,
      autonomy,
      error: String(error?.message || error),
    });
    return json(500, { error: "Agent run failed." });
  }
};