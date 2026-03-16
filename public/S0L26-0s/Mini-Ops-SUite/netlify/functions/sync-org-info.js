const { query } = require('./_db');
const { ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');

function isLikelyReal(jwk){
  try{
    if(!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') return false;
    return (String(jwk.x||'').length > 20 && String(jwk.y||'').length > 20);
  }catch(_){ return false; }
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  try{
    const org = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');

    const orgInfo = {
      orgSaltB64: org.rows[0].org_salt_b64,
      orgKdfIterations: org.rows[0].org_kdf_iterations,
      orgEpoch: Number(org.rows[0].key_epoch||1),
      tokenVersion: Number(org.rows[0].token_version||1),
      keyModel: org.rows[0].key_model || 'passphrase-v1',
      policy: org.rows[0].policy || {}
    };

    // Token version mismatch -> force re-auth, but still return the authoritative org info.
    const tv = Number(tokenUser.tv||0);
    if(tv && tv !== orgInfo.tokenVersion) return bad(event, 401, 'token-stale', orgInfo);

    const me = await query('SELECT role, status, enc_pubkey_jwk, pubkey_jwk FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    // Does this user currently have a wrapped DEK for this epoch?
    let dekReady = false;
    try{
      const w = await query('SELECT 1 FROM sync_dek_wraps WHERE org_id=$1 AND epoch=$2 AND user_id=$3', [tokenUser.orgId, orgInfo.orgEpoch, tokenUser.sub]);
      dekReady = (w.rowCount === 1);
    }catch(_){ /* ignore */ }

    return ok(event, Object.assign({
      ok: true,
      userId: tokenUser.sub,
      orgId: tokenUser.orgId,
      role: me.rows[0].role,
      encKeyReady: isLikelyReal(me.rows[0].enc_pubkey_jwk),
      authKeyReady: isLikelyReal(me.rows[0].pubkey_jwk),
      dekReady,
      serverTime: new Date().toISOString()
    }, orgInfo));
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
