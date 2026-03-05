export function readIdempotencyKey(event: any, body?: any): string {
  const fromHeaderRaw =
    event?.headers?.["x-idempotency-key"] ||
    event?.headers?.["X-Idempotency-Key"] ||
    event?.headers?.["x_idempotency_key"] ||
    "";
  const fromBodyRaw = body?.idempotency_key || "";
  const key = String(fromHeaderRaw || fromBodyRaw || "").trim();
  // Allow simple token-safe chars and cap length.
  if (!key) return "";
  const safe = key.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
  return safe;
}
