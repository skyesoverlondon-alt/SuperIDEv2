import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import { parseCookies, clearSessionCookie } from "./_shared/auth";

export const handler = async (event: any) => {
  // Remove session record if possible.
  try {
    const cookies = parseCookies(event.headers?.cookie);
    const token = cookies["kx_session"];
    if (token) {
      await q("delete from sessions where token=$1", [token]);
    }
  } catch (_) {
    // ignore errors
  }
  return json(
    200,
    { ok: true },
    { "Set-Cookie": clearSessionCookie(event) }
  );
};