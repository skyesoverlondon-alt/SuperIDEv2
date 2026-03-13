export type AgentWorkspaceFile = {
  path: string;
  content: string;
};

export type AgentOperation =
  | {
      type: "create" | "update";
      path: string;
      content: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "rename";
      from: string;
      to: string;
    };

type ContextDepth = "light" | "balanced" | "deep";

function normalizePath(value: unknown): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function isLikelyTextPath(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|pdf|woff2?|ttf|ico|mp4|mp3|mov|avi|wasm|lock|zip|gz|tar|bin)$/i.test(path);
}

function extname(path: string): string {
  const clean = normalizePath(path);
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : "";
}

function basename(path: string): string {
  const clean = normalizePath(path);
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}

function tokenizePrompt(prompt: string): string[] {
  return Array.from(
    new Set(
      String(prompt || "")
        .toLowerCase()
        .replace(/[^a-z0-9_./ -]+/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function scorePathForPrompt(path: string, prompt: string): number {
  const tokens = tokenizePrompt(prompt);
  const lowerPath = normalizePath(path).toLowerCase();
  const name = basename(lowerPath);
  let score = 0;

  for (const token of tokens) {
    if (lowerPath.includes(token)) score += token.length > 4 ? 8 : 4;
    if (name === token) score += 12;
    if (name.startsWith(token)) score += 6;
  }

  if (/readme|package\.json|netlify\.toml|vite\.config|tsconfig|manifest\.json|index\.html/.test(lowerPath)) score += 6;
  if (/app\.|editor\.|styles\.|worker\//.test(lowerPath)) score += 4;
  if (/test|spec/.test(lowerPath) && /test|bug|fail|error|fix|regression/.test(prompt.toLowerCase())) score += 5;
  return score;
}

function snippetForContent(content: string, maxChars: number): string {
  const text = String(content || "");
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.78));
  const tail = text.slice(-Math.floor(maxChars * 0.18));
  return `${head}\n/* ... truncated for context ... */\n${tail}`;
}

export function normalizeWorkspaceFiles(input: unknown): AgentWorkspaceFile[] {
  const deduped = new Map<string, AgentWorkspaceFile>();
  const items = Array.isArray(input) ? input : [];
  for (const raw of items) {
    const path = normalizePath((raw as any)?.path);
    if (!path || !isLikelyTextPath(path)) continue;
    deduped.set(path, {
      path,
      content: typeof (raw as any)?.content === "string" ? (raw as any).content : "",
    });
  }
  return Array.from(deduped.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function summarizeWorkspace(files: AgentWorkspaceFile[]): string {
  const languageCounts = files.reduce<Record<string, number>>((acc, file) => {
    const extension = extname(file.path) || "txt";
    acc[extension] = (acc[extension] || 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([language, count]) => `${language} ${count}`)
    .join(" | ");
  return `${files.length} files${top ? ` | ${top}` : ""}`;
}

export function buildProjectMap(files: AgentWorkspaceFile[], maxLines = 140): string {
  const lines: string[] = [];
  for (const file of files) {
    if (lines.length >= maxLines) {
      lines.push(`... (${files.length - maxLines} more files)`);
      break;
    }
    lines.push(`${file.path} | ${String(file.content || "").length}b`);
  }
  return lines.join("\n");
}

export function buildSeedContext(
  files: AgentWorkspaceFile[],
  prompt: string,
  options: { depth?: ContextDepth } = {}
): { selected: string[]; context: string } {
  const depth = options.depth || "balanced";
  const maxFiles = depth === "deep" ? 18 : depth === "light" ? 8 : 12;
  const maxSnippetChars = depth === "deep" ? 12000 : 7000;
  const ranked = files
    .filter((file) => isLikelyTextPath(file.path))
    .map((file) => ({ ...file, score: scorePathForPrompt(file.path, prompt) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });
  const selected = ranked.slice(0, maxFiles);
  return {
    selected: selected.map((file) => file.path),
    context: selected
      .map((file) => `FILE: ${file.path}\n${snippetForContent(file.content, maxSnippetChars)}`)
      .join("\n\n---\n\n"),
  };
}

export function sanitizeOperations(input: unknown): AgentOperation[] {
  const operations = Array.isArray(input) ? input : [];
  const sanitized: AgentOperation[] = [];
  const seenDeletes = new Set<string>();
  for (const raw of operations) {
    const type = String((raw as any)?.type || "").trim().toLowerCase();
    if ((type === "create" || type === "update") && typeof (raw as any)?.path === "string") {
      sanitized.push({
        type,
        path: normalizePath((raw as any).path),
        content: typeof (raw as any)?.content === "string" ? (raw as any).content : "",
      });
      continue;
    }
    if (type === "delete" && typeof (raw as any)?.path === "string") {
      const path = normalizePath((raw as any).path);
      if (!path || seenDeletes.has(path)) continue;
      seenDeletes.add(path);
      sanitized.push({ type: "delete", path });
      continue;
    }
    if (type === "rename" && typeof (raw as any)?.from === "string" && typeof (raw as any)?.to === "string") {
      const from = normalizePath((raw as any).from);
      const to = normalizePath((raw as any).to);
      if (!from || !to || from === to) continue;
      sanitized.push({ type: "rename", from, to });
    }
  }
  return sanitized;
}

export function applyOperationsToWorkspace(
  files: AgentWorkspaceFile[],
  operations: AgentOperation[]
): { files: AgentWorkspaceFile[]; touched: string[] } {
  const map = new Map(files.map((file) => [file.path, { ...file }]));
  const touched = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "create" || operation.type === "update") {
      map.set(operation.path, { path: operation.path, content: operation.content });
      touched.add(operation.path);
      continue;
    }
    if (operation.type === "delete") {
      map.delete(operation.path);
      touched.add(operation.path);
      continue;
    }
    if (operation.type === "rename") {
      const existing = map.get(operation.from);
      map.delete(operation.from);
      map.set(operation.to, { path: operation.to, content: existing?.content || "" });
      touched.add(operation.from);
      touched.add(operation.to);
    }
  }
  return {
    files: Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path)),
    touched: Array.from(touched),
  };
}