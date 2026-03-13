/**
 * ai-agent.js — Deep-refactored repo-aware agent lane
 *
 * Major upgrades:
 * - Smart context seeding instead of dumping the whole repo into the prompt
 * - Explicit plan/execute modes
 * - Preview operations in plan mode (nothing is applied until frontend Apply)
 * - Operation budgeting + sanitization
 * - Rich execution report for the UI
 */

const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { query } = require('./_lib/db');
const logger = require('./_lib/logger')('ai-agent');
const { checkQuota, recordUsage } = require('./_lib/quota');
const { checkRateLimit } = require('./_lib/ratelimit');
const openai = require('./_lib/openai');
const {
  normalizeWorkspace,
  buildProjectMap,
  buildSeedContext,
  summarizeWorkspace,
  sanitizeOperations,
} = require('./_lib/workspace');

function buildAgentTools(mode = 'execute') {
  const common = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the full content of a workspace file before changing it.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path like src/App.js' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List all files in the workspace with size and binary metadata.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_codebase',
        description: 'Search across workspace files for symbols, strings, selectors, routes, config keys, and patterns.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            case_sensitive: { type: 'boolean' },
          },
          required: ['query'],
        },
      },
    },
  ];

  const mutating = [
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: mode === 'plan'
          ? 'Stage a PREVIEW create/update operation. Content must be the COMPLETE file content.'
          : 'Create or overwrite a file. Content must be the COMPLETE file content.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: mode === 'plan'
          ? 'Stage a PREVIEW delete operation for review.'
          : 'Delete a file from the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rename_file',
        description: mode === 'plan'
          ? 'Stage a PREVIEW rename or move operation for review.'
          : 'Rename or move a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
    },
  ];

  return [...common, ...mutating];
}

function agentSystemPrompt({ agentMemory = '', mode = 'execute', workspaceSummary = '', projectMap = '', seedFiles = [] }) {
  const planSpecific = mode === 'plan'
    ? `
## Mode: PLAN PREVIEW
You are preparing a reviewable execution plan.
- You MAY use mutating tools to stage PREVIEW operations.
- These operations are NOT applied yet; they are only proposed changes.
- Keep the plan sharp: what changes, why, and any risks.
- Prefer staged operations when the task is concrete enough.
- If the task is ambiguous, do not invent giant refactors. Explain the constraint.
`
    : `
## Mode: EXECUTE
You are executing the user's requested change set.
- Make the needed file operations directly in the sandbox.
- Read relevant files first.
- Minimize collateral churn.
- Deliver a concise completion report.
`;

  return `You are kAIx4nthi4 4.6 — a repo-aware coding agent operating inside a browser IDE.
You can inspect, search, plan, and stage full-file operations across the workspace.

## Core behavior
1. Read before writing.
2. Use search_codebase when symbols may appear in multiple files.
3. Respect existing patterns, structure, naming, and style.
4. When you write a file, write the COMPLETE file content.
5. Do not output diffs or partial snippets as file content.
6. When a task touches UI, check HTML + JS + CSS together.
7. When a task touches integrations, inspect config/env callers and endpoints.

${planSpecific}

## Final response format
Use these exact sections:
SUMMARY:
- one concise paragraph

CHANGES:
- bullet list of files changed or planned

RISKS:
- bullet list, or "- none obvious"

NEXT:
- short sentence about what to test or verify next

## Workspace summary
${workspaceSummary || 'No summary available.'}

## Seeded high-signal files
${seedFiles.length ? seedFiles.map((f) => `- ${f}`).join('\n') : '- none'}

## Project map
${projectMap || '(empty workspace)'}

${agentMemory ? `## Workspace conventions\n${agentMemory}\n` : ''}

Be decisive. No fluffy goblin fog.`;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createWorkspace(filesMap, options = {}) {
  return {
    files: new Map(filesMap),
    operations: [],
    touched: new Set(),
    operationBudget: Number(options.operationBudget) || 32,
  };
}

function executeToolCall(toolName, args, workspace) {
  const { files } = workspace;

  if (['write_file', 'delete_file', 'rename_file'].includes(toolName) && workspace.operations.length >= workspace.operationBudget) {
    return JSON.stringify({ error: `Operation budget reached (${workspace.operationBudget}). Consolidate changes.` });
  }

  switch (toolName) {
    case 'read_file': {
      const content = files.get(args.path);
      if (content === undefined) return JSON.stringify({ error: `File not found: ${args.path}` });
      if (String(content).startsWith('__b64__:')) return JSON.stringify({ path: args.path, binary: true, content: '[binary omitted]' });
      return JSON.stringify({ path: args.path, content, lines: String(content).split('\n').length });
    }
    case 'list_files': {
      const listing = Array.from(files.keys()).sort().map((path) => {
        const value = files.get(path) || '';
        return {
          path,
          bytes: String(value).length,
          binary: String(value).startsWith('__b64__:'),
        };
      });
      return JSON.stringify({ total: listing.length, files: listing });
    }
    case 'search_codebase': {
      const q = String(args.query || '').trim();
      if (!q) return JSON.stringify({ query: q, matches: 0, results: [] });
      const regex = new RegExp(escapeRegex(q), args.case_sensitive ? 'g' : 'gi');
      const results = [];
      for (const [path, content] of files.entries()) {
        const text = String(content || '');
        if (text.startsWith('__b64__:')) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 220) });
            if (results.length >= 80) break;
          }
          regex.lastIndex = 0;
        }
        if (results.length >= 80) break;
      }
      return JSON.stringify({ query: q, matches: results.length, results });
    }
    case 'write_file': {
      if (typeof args.path !== 'string') return JSON.stringify({ error: 'path is required' });
      const existed = files.has(args.path);
      const content = typeof args.content === 'string' ? args.content : '';
      files.set(args.path, content);
      workspace.operations.push({ type: existed ? 'update' : 'create', path: args.path, content });
      workspace.touched.add(args.path);
      return JSON.stringify({ ok: true, type: existed ? 'update' : 'create', path: args.path, bytes: content.length });
    }
    case 'delete_file': {
      if (!files.has(args.path)) return JSON.stringify({ error: `File not found: ${args.path}` });
      files.delete(args.path);
      workspace.operations.push({ type: 'delete', path: args.path });
      workspace.touched.add(args.path);
      return JSON.stringify({ ok: true, deleted: args.path });
    }
    case 'rename_file': {
      if (!files.has(args.from)) return JSON.stringify({ error: `File not found: ${args.from}` });
      const content = files.get(args.from);
      files.delete(args.from);
      files.set(args.to, content);
      workspace.operations.push({ type: 'rename', from: args.from, to: args.to });
      workspace.touched.add(args.from);
      workspace.touched.add(args.to);
      return JSON.stringify({ ok: true, from: args.from, to: args.to });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

const MAX_ITERATIONS = 18;

async function runAgentLoop({ model, systemPrompt, userMessage, workspace, mode }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let iterations = 0;
  const tools = buildAgentTools(mode);

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const response = await openai.chatCompletion({
      model,
      messages,
      tools,
      temperature: mode === 'plan' ? 0.15 : 0.2,
      max_tokens: 16384,
    });

    const choice = response.choices?.[0];
    const usage = response.usage || {};
    totalUsage.prompt_tokens += usage.prompt_tokens || 0;
    totalUsage.completion_tokens += usage.completion_tokens || 0;

    if (!choice?.message) throw new Error('No response from OpenAI');

    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason !== 'tool_calls' && (!msg.tool_calls || !msg.tool_calls.length)) {
      const ops = sanitizeOperations(workspace.operations);
      return {
        reply: msg.content || (mode === 'plan' ? 'Plan ready.' : 'Done.'),
        operations: ops,
        touched: Array.from(workspace.touched),
        summary: ops.length ? `${ops.length} staged file operation(s)` : 'No file changes',
        usage: totalUsage,
        iterations,
        model: response.model || model,
      };
    }

    for (const tc of msg.tool_calls || []) {
      let args = {};
      try {
        args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
      } catch {}

      const result = executeToolCall(tc.function?.name, args, workspace);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }

  const ops = sanitizeOperations(workspace.operations);
  return {
    reply: `Agent reached the ${MAX_ITERATIONS}-iteration cap. Review staged operations before applying.`,
    operations: ops,
    touched: Array.from(workspace.touched),
    summary: ops.length ? `${ops.length} staged operation(s) — iteration cap reached` : 'Iteration cap reached with no file changes',
    usage: totalUsage,
    iterations,
    model,
  };
}

function buildUserMessage({ prompt, seedContext, ragContext = '', mode = 'execute', smartContext = true }) {
  const sections = [
    `TASK:\n${prompt}`,
    `RUN_MODE: ${mode.toUpperCase()}`,
  ];

  if (smartContext && seedContext) {
    sections.push(`HIGH_SIGNAL_CONTEXT:\n${seedContext}`);
  }
  if (ragContext) sections.push(`RAG_CONTEXT:\n${ragContext}`);
  return sections.join('\n\n');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return json(401, { ok: false, error: 'Invalid token' });
  }
  const userId = decoded?.sub || decoded?.userId || null;

  const limited = await checkRateLimit(userId || token, 'ai-agent', { maxHits: 15, windowSecs: 60 });
  if (limited) return json(429, { ok: false, error: 'Too many agent requests. Limit: 15/min.', retryAfter: 60 });

  try {
    const ks = await query(`SELECT value FROM global_settings WHERE key='ai_enabled'`);
    if (ks.rows[0]?.value === 'false') return json(503, { ok: false, error: 'AI is currently disabled by an administrator.' });
  } catch {}

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const {
    prompt,
    files: clientFiles,
    model: requestedModel,
    workspaceId,
    orgId: bodyOrgId,
    agentMemory,
    mode = 'execute',
    smartContext = true,
    contextDepth = 'balanced',
    operationBudget = 32,
  } = parsed.data || {};

  if (!prompt || typeof prompt !== 'string') return json(400, { ok: false, error: 'Missing prompt' });

  const quotaOrgId = bodyOrgId || null;
  const quota = await checkQuota(userId, quotaOrgId);
  if (!quota.allowed) {
    return json(429, {
      ok: false,
      error: `Monthly AI limit reached (${quota.used}/${quota.limit}). Resets ${quota.resetAt?.toISOString?.() || 'next month'}.`,
      quota,
    });
  }
  recordUsage(userId, quotaOrgId, workspaceId || null);

  if (!openai.isConfigured()) {
    return json(503, { ok: false, error: 'OPENAI_API_KEY not configured. Set it in Netlify environment variables.' });
  }

  const MODEL_ALIASES = {
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'o3-mini': 'o3-mini',
    'gpt-4.1': 'gpt-4.1',
    'gpt-4.1-mini': 'gpt-4.1-mini',
    'gpt-4.1-nano': 'gpt-4.1-nano',
  };
  const model = MODEL_ALIASES[requestedModel] || 'gpt-4o';

  const normalized = normalizeWorkspace(clientFiles);
  const workspace = createWorkspace(normalized.files, { operationBudget });
  const workspaceSummary = summarizeWorkspace(normalized.meta);
  const projectMap = buildProjectMap(normalized.meta, contextDepth === 'deep' ? 220 : 140);
  const seeded = buildSeedContext(normalized, prompt, {
    depth: contextDepth === 'deep' ? 'deep' : contextDepth === 'light' ? 'light' : 'balanced',
  });

  let ragContext = '';
  if (workspaceId) {
    try {
      const { rows } = await query(
        `SELECT file_path, chunk_text FROM file_embeddings WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 8`,
        [workspaceId]
      );
      if (rows.length) {
        ragContext = rows.map((r) => `// ${r.file_path}\n${r.chunk_text}`).join('\n---\n');
      }
    } catch {}
  }

  const startMs = Date.now();
  try {
    const result = await runAgentLoop({
      model,
      mode: mode === 'plan' ? 'plan' : 'execute',
      systemPrompt: agentSystemPrompt({
        agentMemory: agentMemory || '',
        mode: mode === 'plan' ? 'plan' : 'execute',
        workspaceSummary,
        projectMap,
        seedFiles: seeded.selected,
      }),
      userMessage: buildUserMessage({
        prompt,
        seedContext: smartContext ? seeded.context : '',
        ragContext,
        mode: mode === 'plan' ? 'plan' : 'execute',
        smartContext: !!smartContext,
      }),
      workspace,
    });

    const latency = Date.now() - startMs;
    query(
      `INSERT INTO ai_usage_log(user_id, workspace_id, model, prompt_tokens, completion_tokens, latency_ms, success)
       VALUES($1,$2,$3,$4,$5,$6,true)`,
      [userId, workspaceId || null, result.model, result.usage.prompt_tokens, result.usage.completion_tokens, latency]
    ).catch(() => {});

    return json(200, {
      ok: true,
      result: {
        reply: result.reply,
        summary: result.summary,
        operations: result.operations,
        touched: result.touched,
        report: {
          mode: mode === 'plan' ? 'plan' : 'execute',
          smartContext: !!smartContext,
          contextDepth,
          seededFiles: seeded.selected,
          workspaceFiles: normalized.meta.length,
          operationBudget: Number(operationBudget) || 32,
        },
      },
      usage: result.usage,
      model: result.model,
      iterations: result.iterations,
      latencyMs: latency,
    });
  } catch (err) {
    logger.error('agent_failed', { error: err.message, model, mode, workspaceId });
    return json(err.status === 429 ? 429 : 500, {
      ok: false,
      error: String(err?.message || err),
    });
  }
};
