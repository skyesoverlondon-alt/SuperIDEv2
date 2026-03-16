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

    const r = await query('SELECT issuer, client_id, redirect_uri, scope, claim_email, claim_name, claim_groups, require_verified_email, role_map, vault_map, updated_at FROM sync_sso_oidc WHERE org_id=$1', [tokenUser.orgId]);
    if(r.rowCount !== 1) return ok(event, { configured:false });
    const row = r.rows[0];
    return ok(event, {
      configured: true,
      issuer: row.issuer,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      scope: row.scope,
      claimEmail: row.claim_email,
      claimName: row.claim_name,
      claimGroups: row.claim_groups,
      requireVerifiedEmail: !!row.require_verified_email,
      roleMap: row.role_map || {},
      vaultMap: row.vault_map || {},
      updatedAt: row.updated_at
    });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
