export type WorkspaceFileRecord = {
  path: string;
  content: string;
};

export type WorkspaceTreeEntry = {
  path: string;
  size: number;
};

export type WorkspaceSnapshot = {
  files: WorkspaceFileRecord[];
  revision: string;
};

export type WorkspaceTreeSnapshot = {
  files: WorkspaceTreeEntry[];
  revision: string;
};

function sanitizeWorkspaceFiles(value: unknown): WorkspaceFileRecord[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const row = entry as Partial<WorkspaceFileRecord>;
      const path = String(row.path || "").trim().replace(/^\/+/, "");
      const content = typeof row.content === "string" ? row.content : "";
      if (!path) return null;
      return { path, content };
    })
    .filter((row): row is WorkspaceFileRecord => Boolean(row));
}

export function serializeWorkspaceFiles(files: WorkspaceFileRecord[]): string {
  const normalized = sanitizeWorkspaceFiles(files)
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(normalized);
}

export async function fetchWorkspaceFiles(workspaceId: string): Promise<WorkspaceSnapshot> {
  const qs = new URLSearchParams({ id: workspaceId.trim() });
  const response = await fetch(`/api/ws-get?${qs.toString()}`, { method: "GET" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || `Workspace load failed (${response.status}).`);
  }

  return {
    files: sanitizeWorkspaceFiles(payload?.files),
    revision: typeof payload?.revision === "string" ? payload.revision : "",
  };
}

export async function fetchWorkspaceTree(workspaceId: string): Promise<WorkspaceTreeSnapshot> {
  const qs = new URLSearchParams({ id: workspaceId.trim() });
  const response = await fetch(`/api/ide/tree?${qs.toString()}`, { method: "GET" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || `Workspace tree failed (${response.status}).`);
  }

  const files = Array.isArray(payload?.files)
    ? payload.files
        .map((entry: any) => {
          const path = String(entry?.path || "").trim().replace(/^\/+/, "");
          if (!path) return null;
          return { path, size: Number(entry?.size) || 0 };
        })
        .filter((entry: WorkspaceTreeEntry | null): entry is WorkspaceTreeEntry => Boolean(entry))
    : [];

  return {
    files,
    revision: typeof payload?.revision === "string" ? payload.revision : "",
  };
}

export async function fetchWorkspaceFile(workspaceId: string, path: string): Promise<{ path: string; content: string; revision: string }> {
  const qs = new URLSearchParams({ id: workspaceId.trim(), path: String(path || "").trim() });
  const response = await fetch(`/api/ide/file?${qs.toString()}`, { method: "GET" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || `Workspace file load failed (${response.status}).`);
  }

  return {
    path: String(payload?.file?.path || "").trim().replace(/^\/+/, ""),
    content: typeof payload?.file?.content === "string" ? payload.file.content : "",
    revision: typeof payload?.revision === "string" ? payload.revision : "",
  };
}

export async function persistWorkspaceFiles(
  workspaceId: string,
  files: WorkspaceFileRecord[],
  options: { expectedRevision?: string; force?: boolean } = {}
): Promise<{ revision: string }> {
  const response = await fetch("/api/ws-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: workspaceId.trim(),
      files,
      expected_revision: options.expectedRevision || "",
      force: Boolean(options.force),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error || `Workspace save failed (${response.status}).`);
    (error as any).status = response.status;
    (error as any).conflict = payload?.conflict;
    throw error;
  }

  return { revision: typeof payload?.revision === "string" ? payload.revision : "" };
}
