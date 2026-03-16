const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');
  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    if(!requireRole({role: me.rows[0].role}, 'admin')) return bad(event, 403, 'forbidden');

    const org = await query('SELECT policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount === 1){
      const pol = normalizePolicy(org.rows[0].policy || {});
      const ip = getClientIp(event);
      if((pol.requireIpAllowlist || (pol.ipAllowlist && pol.ipAllowlist.length)) && !ipInAllowlist(ip, pol.ipAllowlist)){
        return bad(event, 403, 'ip-not-allowed');
      }
    }

    const r = await query('SELECT id, name, created_by, created_at, last_used_at, revoked, revoked_at FROM sync_scim_tokens WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200', [tokenUser.orgId]);
    return ok(event, { tokens: r.rows.map(x=>({
      id: x.id,
      name: x.name,
      createdBy: x.created_by,
      createdAt: x.created_at,
      lastUsedAt: x.last_used_at,
      revoked: !!x.revoked,
      revokedAt: x.revoked_at
    }))});
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
