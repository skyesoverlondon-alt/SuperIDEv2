import { ensureDefaultProject, ensureSchema, logAudit, sql, upsertUser } from './_lib/db.js';
import { getNetlifyIdentity, json, noContent, unauthorized, serverError } from './_lib/http.js';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return noContent();
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  try {
    const { user } = getNetlifyIdentity(context);
    if (!user?.sub) {
      return unauthorized('Log in with Netlify Identity first.');
    }

    await ensureSchema();
    await upsertUser({
      identityUid: user.sub,
      email: user.email || '',
      fullName: user.user_metadata?.full_name || user.user_metadata?.name || '',
      userMetadata: user.user_metadata || {},
      appMetadata: user.app_metadata || {},
      rawJson: user,
      lastIp: event.headers['x-forwarded-for'] || ''
    });

    const project = await ensureDefaultProject(user.sub);

    await logAudit({
      actorIdentityUid: user.sub,
      eventType: 'identity_sync',
      summary: `Identity sync for ${user.email || user.sub}`,
      payload: { email: user.email || '', projectId: project.id }
    });

    return json(200, {
      ok: true,
      user: {
        id: user.sub,
        email: user.email || '',
        fullName: user.user_metadata?.full_name || user.user_metadata?.name || '',
        roles: user.app_metadata?.roles || []
      },
      project
    });
  } catch (error) {
    return serverError(error);
  }
};
