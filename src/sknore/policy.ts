export type SknorePolicy = {
  patterns: string[];
};

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
      patterns
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.replace(/^\/+/, ""))
    )
  );
}

export function isSknoreProtected(path: string, patterns: string[]): boolean {
  const target = path.replace(/^\/+/, "");
  return patterns.some((pattern) => globToRegex(pattern).test(target));
}

export function filterSknoreFiles<T extends { path: string }>(files: T[], patterns: string[]): T[] {
  return files.filter((f) => !isSknoreProtected(f.path, patterns));
}
