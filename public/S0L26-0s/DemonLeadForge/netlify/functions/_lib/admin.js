import crypto from 'node:crypto';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function unbase64url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

export function verifyBemonKey(candidate) {
  const expected = process.env.BEMON_KEY || '';
  if (!expected || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signAdminSession({ actor = 'unknown' } = {}) {
  const secret = process.env.BEMON_KEY || '';
  if (!secret) {
    throw new Error('BEMON_KEY is not configured.');
  }

  const payload = {
    sub: 'bemon-admin',
    actor,
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 8
  };

  const payloadEncoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(payloadEncoded).digest('base64url');
  return `${payloadEncoded}.${signature}`;
}

export function verifyAdminSession(token) {
  if (!token || !token.includes('.')) return { ok: false, reason: 'Missing token.' };
  const [payloadEncoded, signature] = token.split('.');
  const secret = process.env.BEMON_KEY || '';
  if (!secret) return { ok: false, reason: 'BEMON_KEY is not configured.' };
  const expected = crypto.createHmac('sha256', secret).update(payloadEncoded).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Bad signature.' };
  }

  const payload = JSON.parse(unbase64url(payloadEncoded));
  if (!payload.exp || Date.now() > payload.exp) {
    return { ok: false, reason: 'Expired token.' };
  }

  return { ok: true, payload };
}
