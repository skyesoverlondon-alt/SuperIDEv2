const { tx, query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

function isEcP256Jwk(jwk){
  return jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string';
}

function isLikelyReal(jwk){
  if(!isEcP256Jwk(jwk)) return false;
  // Basic sanity: real JWK coordinates are base64url-ish and longer than a couple chars.
  return (String(jwk.x).length > 20 && String(jwk.y).length > 20);
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const encPubKeyJwk = body.encPubKeyJwk;
  const authPubKeyJwk = body.authPubKeyJwk;

  const doEnc = (encPubKeyJwk !== undefined);
  const doAuth = (authPubKeyJwk !== undefined);

  if(!doEnc && !doAuth) return bad(event, 400, 'missing-keys');
  if(doEnc && !isEcP256Jwk(encPubKeyJwk)) return bad(event, 400, 'bad-enc-pubkey');
  if(doAuth && !isEcP256Jwk(authPubKeyJwk)) return bad(event, 400, 'bad-auth-pubkey');

  // Stronger guard: reject obviously dummy keys.
  if(doEnc && !isLikelyReal(encPubKeyJwk)) return bad(event, 400, 'enc-key-too-short');
  if(doAuth && !isLikelyReal(authPubKeyJwk)) return bad(event, 400, 'auth-key-too-short');

  try{
    // Enforce org token version
    const org = await query('SELECT token_version, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const tv = Number(tokenUser.tv||0);
    const cur = Number(org.rows[0].token_version||1);
    if(tv && tv !== cur) return bad(event, 401, 'token-stale', { tokenVersion: cur });

    const policy = normalizePolicy(org.rows[0].policy || {});
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }

    const me = await query('SELECT status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    await tx(async (client)=>{
      const sets = [];
      const vals = [];
      let idx = 1;
      if(doEnc){ sets.push(`enc_pubkey_jwk=$${idx++}`); vals.push(encPubKeyJwk); }
      if(doAuth){ sets.push(`pubkey_jwk=$${idx++}`); vals.push(authPubKeyJwk); }
      vals.push(tokenUser.sub);
      vals.push(tokenUser.orgId);
      await client.query(`UPDATE sync_users SET ${sets.join(', ')} WHERE id=$${idx++} AND org_id=$${idx++}`, vals);
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'user.updateKeys', severity:'info', detail:{ enc: doEnc, auth: doAuth } });
    });

    return ok(event, { ok:true });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
