export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
export function ok(body, headers = {}) { return json(200, body, headers); }
export function badRequest(message, extra = {}) { return json(400, { error: message, ...extra }); }
export function unauthorized(message = "Unauthorized", extra = {}) { return json(401, { error: message, ...extra }); }
export function forbidden(message = "Forbidden", extra = {}) { return json(403, { error: message, ...extra }); }
export function serverError(message = "Server error", extra = {}) { return json(500, { error: message, ...extra }); }
