/**
 * Helper to build JSON responses from Netlify functions.  Attaches
 * standard headers and stringifies the body.  Additional headers
 * can be provided via the third argument.
 */
export function json(
  statusCode: number,
  body: any,
  extraHeaders: Record<string, string> = {}
) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body ?? {}),
  };
}