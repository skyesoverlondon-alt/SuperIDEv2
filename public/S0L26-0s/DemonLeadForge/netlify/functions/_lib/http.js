import crypto from 'node:crypto';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Session',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...extraHeaders
    },
    body: JSON.stringify(data)
  };
}

export function text(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...corsHeaders,
      ...extraHeaders
    },
    body
  };
}

export function noContent() {
  return {
    statusCode: 204,
    headers: corsHeaders,
    body: ''
  };
}

export function methodNotAllowed() {
  return json(405, { ok: false, error: 'Method not allowed.' });
}

export function badRequest(message, detail = null) {
  return json(400, { ok: false, error: message, detail });
}

export function unauthorized(message = 'Unauthorized.') {
  return json(401, { ok: false, error: message });
}

export function forbidden(message = 'Forbidden.') {
  return json(403, { ok: false, error: message });
}

export function serverError(error) {
  console.error(error);
  return json(500, {
    ok: false,
    error: 'Server error.',
    detail: error?.message || String(error)
  });
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

export function getQuery(event) {
  return event.queryStringParameters || {};
}

export function getNetlifyIdentity(context) {
  try {
    const raw = context?.clientContext?.custom?.netlify;
    if (raw) {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return parsed || { identity: null, user: null };
    }
  } catch (error) {
    console.warn('Failed to decode Netlify identity context.', error?.message || error);
  }

  return {
    identity: context?.clientContext?.identity || null,
    user: context?.clientContext?.user || null
  };
}

export function makeId(prefix = 'id') {
  const uid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${uid}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function arrayify(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

export function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

export function toTitleCase(input = '') {
  return String(input)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
