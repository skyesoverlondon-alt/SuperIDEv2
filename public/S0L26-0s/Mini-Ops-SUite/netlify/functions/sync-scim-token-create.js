const crypto = require('crypto');
const { tx } = require('./_db');
const { json, ok, bad, preflight, requireRole, uuid } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { scimTokenHash } = require('./_scim');
const { auditTx } = require('./_audit');

function b64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');
  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event) || {};
  const name = String(body.name||'SCIM token').trim().slice(0,80) || 'SCIM token';

  try{
    const out = await tx(async (client)=>{
      const me = await client.query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
      if(me.rowCount !== 1) return { err:{status:401,msg:'unauthorized'} };
      if(me.rows[0].status !== 'active') return { err:{status:403,msg:'user-disabled'} };
      if(!requireRole({role: me.rows[0].role}, 'admin')) return { err:{status:403,msg:'forbidden'} };

      const org = await client.query('SELECT policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
      if(org.rowCount === 1){
        const pol = normalizePolicy(org.rows[0].policy || {});
        const ip = getClientIp(event);
        if((pol.requireIpAllowlist || (pol.ipAllowlist && pol.ipAllowlist.length)) && !ipInAllowlist(ip, pol.ipAllowlist)){
          return { err:{status:403,msg:'ip-not-allowed'} };
        }
      }

      const token = b64url(crypto.randomBytes(32));
      const tokenHash = scimTokenHash(token);
      const id = uuid();
      await client.query('INSERT INTO sync_scim_tokens(id, org_id, name, token_hash, created_by) VALUES($1,$2,$3,$4,$5)', [id, tokenUser.orgId, name, tokenHash, tokenUser.sub]);
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'scim.token.create', severity:'info', detail:{ name, tokenId:id } });
      return { token, tokenId: id };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
