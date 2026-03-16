const { tx } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');
  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');
  const tokenId = String(body.tokenId||'').trim();
  if(!tokenId) return bad(event, 400, 'tokenId-required');

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

      const r = await client.query('UPDATE sync_scim_tokens SET revoked=true, revoked_at=now() WHERE id=$1 AND org_id=$2', [tokenId, tokenUser.orgId]);
      if(r.rowCount !== 1) return { err:{status:404,msg:'not-found'} };
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'scim.token.revoke', severity:'warn', detail:{ tokenId } });
      return { ok:true };
    });
    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
