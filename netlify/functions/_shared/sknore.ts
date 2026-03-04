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
