const { query } = require('./_db');
const { ok, bad, preflight, json } = require('./_util');
const { open } = require('./_secrets');
const { buildSP, buildIDP } = require('./_saml');
const { signState } = require('./_sso_state');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');

function redirect(status, loc){
  return { statusCode: status, headers: { Location: loc, 'Cache-Control':'no-store' }, body: '' };
}

function readInputs(event){
  const q = event.queryStringParameters || {};
  if(event.httpMethod === 'GET'){
    return {
      orgId: String(q.orgId||'').trim(),
      deviceId: String(q.deviceId||'').trim().slice(0,80) || '',
      returnTo: String(q.returnTo||'').trim()
    };
  }
  const b = json(event) || {};
  return {
    orgId: String(b.orgId||'').trim(),
    deviceId: String(b.deviceId||'').trim().slice(0,80) || '',
    returnTo: String(b.returnTo||'').trim()
  };
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const { orgId, deviceId, returnTo } = readInputs(event);
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

    const cfg = await query('SELECT idp_sso_url, idp_cert_pem, sp_entity_id, sp_acs_url, sp_cert_pem, sp_key_enc, want_assertions_signed, want_response_signed, nameid_format, clock_skew_sec FROM sync_sso_saml WHERE org_id=$1', [orgId]);
    if(cfg.rowCount !== 1) return bad(event, 409, 'saml-not-configured');
    const row = cfg.rows[0];

    const privKey = row.sp_key_enc ? open(row.sp_key_enc, orgId) : null;

    const sp = buildSP({
      spEntityId: row.sp_entity_id,
      acsUrl: row.sp_acs_url,
      wantAssertionsSigned: row.want_assertions_signed !== false,
      wantResponseSigned: row.want_response_signed !== false,
      nameIdFormat: row.nameid_format || null,
      signingCertPem: row.sp_cert_pem || null,
      privateKeyPem: privKey || null
    });

    const idp = buildIDP({ idpSsoUrl: row.idp_sso_url, idpCertPem: row.idp_cert_pem });

    const now = Math.floor(Date.now()/1000);
    const relayState = signState({
      typ: 'saml-state-v1',
      orgId,
      did: deviceId || undefined,
      rt: returnTo || undefined,
      iat: now,
      exp: now + 600
    });

    // Create AuthnRequest (redirect binding)
    const req = sp.createLoginRequest(idp, 'redirect', { relayState });
    const redirectUrl = req && req.context ? req.context : '';
    if(!redirectUrl) return bad(event, 500, 'saml-login-failed');

    if(event.httpMethod === 'GET'){
      return redirect(302, redirectUrl);
    }
    return ok(event, { redirectUrl });
  }catch(e){
    return bad(event, 500, 'saml-login-failed');
  }
};
