const { tx, query } = require('./_db');
const { json, ok, bad, preflight, uuid, jwtSign } = require('./_util');
const { rateLimitIp } = require('./_rate');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  // Prevent org creation spam.
  try{
    const r = await rateLimitIp(event, 'org-create', 6, 60);
    if(!r.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r.retryAfterSec });
  }catch(_){
    return bad(event, 500, 'rate-limit-error');
  }

  const orgName = String(body.orgName||'').trim().slice(0,80);
  const userName = String(body.userName||'').trim().slice(0,80);
  const deviceId = String(body.deviceId||'').trim().slice(0,80) || null;
  const authPubKeyJwk = body.authPubKeyJwk || body.pubKeyJwk;
  const encPubKeyJwk = body.encPubKeyJwk;

  if(!orgName || !userName) return bad(event, 400, 'orgName-and-userName-required');
  if(!authPubKeyJwk || authPubKeyJwk.kty !== 'EC' || authPubKeyJwk.crv !== 'P-256') return bad(event, 400, 'bad-auth-pubkey');
  if(!encPubKeyJwk || encPubKeyJwk.kty !== 'EC' || encPubKeyJwk.crv !== 'P-256') return bad(event, 400, 'bad-enc-pubkey');

  const orgId = uuid();
  const userId = uuid();
  const role = 'owner';

  const orgSalt = require('crypto').randomBytes(16).toString('base64');
  const orgIter = 250000;
  const orgEpoch = 1;
  const tokenVersion = 1;
  const keyModel = 'wrapped-epoch-vault-v1';

  try{
    await tx(async (client)=>{
      await client.query('INSERT INTO sync_orgs(id,name,org_salt_b64,org_kdf_iterations,key_epoch,token_version,key_model) VALUES($1,$2,$3,$4,$5,$6,$7)', [orgId, orgName, orgSalt, orgIter, orgEpoch, tokenVersion, keyModel]);
      await client.query('INSERT INTO sync_org_epochs(org_id,epoch,org_salt_b64,org_kdf_iterations) VALUES($1,$2,$3,$4) ON CONFLICT (org_id,epoch) DO NOTHING', [orgId, orgEpoch, orgSalt, orgIter]);
      await client.query('INSERT INTO sync_users(id,org_id,name,role,pubkey_jwk,enc_pubkey_jwk) VALUES($1,$2,$3,$4,$5,$6)', [userId, orgId, userName, role, authPubKeyJwk, encPubKeyJwk]);
      await auditTx(client, event, { orgId, userId, deviceId, action: 'org.create', severity: 'info', detail: { orgName } });
    });

    const now = Math.floor(Date.now()/1000);
    const token = jwtSign({ sub: userId, orgId, role, did: deviceId || undefined, tv: tokenVersion, uv: 1, epoch: orgEpoch, iat: now, exp: now + (7*24*3600) });
    return ok(event, { orgId, userId, role, token, orgSaltB64: orgSalt, orgKdfIterations: orgIter, orgEpoch, tokenVersion, keyModel });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
