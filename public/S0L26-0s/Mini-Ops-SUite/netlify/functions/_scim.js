const crypto = require('crypto');
const { query } = require('./_db');

function base64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function hmac(secret, data){
  return crypto.createHmac('sha256', secret).update(String(data)).digest();
}

function scimTokenHash(token){
  const sec = process.env.SCIM_TOKEN_SECRET || process.env.SYNC_INVITE_SECRET || process.env.SYNC_JWT_SECRET;
  if(!sec) throw new Error('missing SCIM_TOKEN_SECRET (or SYNC_INVITE_SECRET/SYNC_JWT_SECRET)');
  return base64url(hmac(sec, token));
}

function parseBearer(event){
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function authScim(event){
  const tok = parseBearer(event);
  if(!tok) return null;
  const th = scimTokenHash(tok);
  const r = await query('SELECT id, org_id, revoked FROM sync_scim_tokens WHERE token_hash=$1', [th]);
  if(r.rowCount !== 1) return null;
  if(r.rows[0].revoked) return null;
  await query('UPDATE sync_scim_tokens SET last_used_at=now() WHERE id=$1', [r.rows[0].id]);
  return { tokenId: r.rows[0].id, orgId: r.rows[0].org_id };
}

function scimResp(status, obj){
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj)
  };
}

function scimError(status, detail, scimType){
  return scimResp(status, {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail: String(detail||''),
    status: String(status),
    ...(scimType ? { scimType } : {})
  });
}

module.exports = { authScim, scimResp, scimError, scimTokenHash };
