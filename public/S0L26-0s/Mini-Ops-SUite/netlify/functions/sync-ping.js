const { ok, bad, preflight } = require('./_util');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');
  return ok(event, { ok: true, at: new Date().toISOString() });
};
