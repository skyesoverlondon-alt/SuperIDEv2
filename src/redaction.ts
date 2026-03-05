const REDACT_KEY_PATTERNS = [
  /token/i,
  /authorization/i,
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /session/i,
];

function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactStringValue(value: string): string {
  if (!value) return value;
  // Simple email masking.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
  }
  return value;
}

export function redactDiagnosticsValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactDiagnosticsValue(item));
  }
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (shouldRedactKey(key)) {
        next[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        next[key] = redactStringValue(value);
      } else {
        next[key] = redactDiagnosticsValue(value);
      }
    }
    return next;
  }
  if (typeof input === "string") return redactStringValue(input);
  return input;
}
