const crypto = require('crypto');
const { query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { discover } = require('./_oidc');
const { signState, base64url } = require('./_sso_state');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');

function sha256b64url(s){
  return base64url(crypto.createHash('sha256').update(String(s)).digest());
}

function randVerifier(){
  // 43-128 chars (RFC7636). We'll use 64 bytes.
  return base64url(crypto.randomBytes(64));
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const orgId = String(body.orgId||'').trim();
  const deviceId = String(body.deviceId||'').trim().slice(0,80) || '';
  if(!orgId) return bad(event, 400, 'orgId-required');

  try{
    const org = await query('SELECT policy FROM sync_orgs WHERE id=$1', [orgId]);
    if(org.rowCount !== 1) return bad(event, 404, 'org-not-found');

    const policy = normalizePolicy(org.rows[0].policy || {});
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }
    if(policy.requireDeviceId && !deviceId) return bad(event, 400, 'deviceId-required');

    const cfg = await query('SELECT issuer, client_id, redirect_uri, scope FROM sync_sso_oidc WHERE org_id=$1', [orgId]);
    if(cfg.rowCount !== 1) return bad(event, 409, 'oidc-not-configured');

    const issuer = String(cfg.rows[0].issuer||'').replace(/\/$/,'');
    const clientId = String(cfg.rows[0].client_id||'');
    const redirectUri = String(cfg.rows[0].redirect_uri||'');
    const scope = String(cfg.rows[0].scope||'openid email profile');

    const disc = await discover(issuer);

    const codeVerifier = randVerifier();
    const codeChallenge = sha256b64url(codeVerifier);
    const nonce = base64url(crypto.randomBytes(18));

    const now = Math.floor(Date.now()/1000);
    const state = signState({
      typ: 'oidc-state-v1',
      orgId,
      did: deviceId || undefined,
      nonce,
      iat: now,
      exp: now + 600
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authorizeUrl = disc.authorization_endpoint + (disc.authorization_endpoint.includes('?') ? '&' : '?') + params.toString();

    return ok(event, { authorizeUrl, state, codeVerifier, redirectUri });
  }catch(e){
    return bad(event, 500, 'oidc-start-failed');
  }
};
