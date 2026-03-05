export function readCorrelationId(event: any): string {
  const raw =
    event?.headers?.["x-correlation-id"] ||
    event?.headers?.["X-Correlation-Id"] ||
    event?.headers?.["x_correlation_id"] ||
    "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
}
