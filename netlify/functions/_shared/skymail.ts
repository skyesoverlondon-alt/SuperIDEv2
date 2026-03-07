import crypto from "crypto";

function normalizeSubject(subject: string): string {
  return String(subject || "")
    .toLowerCase()
    .replace(/^(re|fwd|fw):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 24);
}

export function computeThreadId(mailbox: string, counterpart: string, subject: string): string {
  const a = String(mailbox || "").trim().toLowerCase();
  const b = String(counterpart || "").trim().toLowerCase();
  const pair = [a, b].sort().join("|");
  const subj = normalizeSubject(subject) || "(no-subject)";
  return `thr_${stableHash(`${pair}|${subj}`)}`;
}

export function normalizeLabels(labels: unknown, defaults: string[] = []): string[] {
  const base = Array.isArray(labels) ? labels : defaults;
  const out = new Set<string>();
  for (const item of base) {
    const v = String(item || "").trim().toLowerCase();
    if (!v) continue;
    if (v.length > 32) continue;
    out.add(v);
  }
  return [...out];
}
