import { logAudit } from './_lib/db.js';
import { parseBody, json, noContent, badRequest, forbidden, serverError, getNetlifyIdentity } from './_lib/http.js';
import { signAdminSession, verifyBemonKey } from './_lib/admin.js';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const body = parseBody(event);
    const { user } = getNetlifyIdentity(context);
    const key = body.key || '';

    if (!key) return badRequest('Missing key.');
    if (!verifyBemonKey(key)) return forbidden('Bad BEMON key.');

    const token = signAdminSession({ actor: user?.email || user?.sub || 'anonymous-admin' });

    await logAudit({
      actorIdentityUid: user?.sub || null,
      eventType: 'admin_unlock',
      summary: `Admin vault unlocked by ${user?.email || 'anonymous operator'}`,
      payload: { actor: user?.email || user?.sub || null }
    });

    return json(200, { ok: true, token });
  } catch (error) {
    return serverError(error);
  }
};
