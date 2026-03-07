import { q } from "./neon";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
  const normalized = glob.trim().replace(/^\/+/, "");
  const escaped = escapeRegex(normalized)
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`, "i");
}

export function normalizeSknorePatterns(patterns: string[]): string[] {
  return Array.from(
    new Set(
      (patterns || [])
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        .map((p) => p.replace(/^\/+/, ""))
    )
  );
}

export function isSknoreProtected(path: string, patterns: string[]): boolean {
  const target = String(path || "").replace(/^\/+/, "");
  const normalized = normalizeSknorePatterns(patterns);
  return normalized.some((pattern) => globToRegex(pattern).test(target));
}

export function filterSknoreFiles<T extends { path: string }>(files: T[], patterns: string[]): T[] {
  return (files || []).filter((f) => !isSknoreProtected(f.path, patterns));
}

export type WorkspaceTextFile = {
  path: string;
  content: string;
};

export function normalizeWorkspaceTextFiles(files: any[]): WorkspaceTextFile[] {
  return (Array.isArray(files) ? files : [])
    .map((file: any) => ({
      path: String(file?.path || "").replace(/^\/+/, ""),
      content: typeof file?.content === "string" ? file.content : "",
    }))
    .filter((file) => file.path);
}

export async function buildSknoreReleasePlan(orgId: string, wsId: string, rawFiles?: any[]): Promise<{
  workspaceName: string | null;
  files: WorkspaceTextFile[];
  releaseFiles: WorkspaceTextFile[];
  blockedPaths: string[];
  patterns: string[];
}> {
  const workspace = await q(
    `select org_id, name, files_json
       from workspaces
      where id=$1
      limit 1`,
    [wsId]
  );

  if (!workspace.rows.length) {
    throw new Error("Workspace not found.");
  }
  if (workspace.rows[0].org_id !== orgId) {
    throw new Error("Forbidden.");
  }

  const files = normalizeWorkspaceTextFiles(
    Array.isArray(rawFiles) ? rawFiles : workspace.rows[0].files_json || []
  );
  const patterns = await loadSknorePolicy(orgId, wsId);
  const blockedPaths = files
    .filter((file) => isSknoreProtected(file.path, patterns))
    .map((file) => file.path);
  const releaseFiles = filterSknoreFiles(files, patterns);

  return {
    workspaceName: workspace.rows[0].name || null,
    files,
    releaseFiles,
    blockedPaths,
    patterns,
  };
}

export async function loadSknorePolicy(orgId: string, wsId: string | null): Promise<string[]> {
  const scoped = wsId
    ? await q(
        `select payload
         from app_records
         where org_id=$1 and app='SKNorePolicy' and ws_id=$2
         order by updated_at desc
         limit 1`,
        [orgId, wsId]
      )
    : { rows: [] as any[] };

  if (scoped.rows.length) {
    const payload = scoped.rows[0]?.payload || {};
    return normalizeSknorePatterns(Array.isArray(payload.patterns) ? payload.patterns : []);
  }

  const orgWide = await q(
    `select payload
     from app_records
     where org_id=$1 and app='SKNorePolicy' and ws_id is null
     order by updated_at desc
     limit 1`,
    [orgId]
  );

  if (!orgWide.rows.length) return [];
  const payload = orgWide.rows[0]?.payload || {};
  return normalizeSknorePatterns(Array.isArray(payload.patterns) ? payload.patterns : []);
}
