const { tx, query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

function validPerm(p){
  return p === 'viewer' || p === 'editor';
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // Enforce org token version + optional IP allowlist
  try{
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
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const vaultKey = String(body.vaultKey||'').trim();
  const restricted = (typeof body.restricted === 'boolean') ? body.restricted : null;
  const grants = Array.isArray(body.grants) ? body.grants : [];

  if(!vaultKey) return bad(event, 400, 'vaultKey-required');
  if(grants.length > 500) return bad(event, 400, 'too-many-grants');

  // owner/admin only
  let dbRole = null;
  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    dbRole = me.rows[0].role;
    if(dbRole !== 'owner' && dbRole !== 'admin') return bad(event, 403, 'forbidden');
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  for(const g of grants){
    if(!g || typeof g !== 'object') return bad(event, 400, 'bad-grant');
    if(!g.userId) return bad(event, 400, 'bad-userId');
    const perm = String(g.perm||'viewer');
    if(!validPerm(perm)) return bad(event, 400, 'bad-perm');
  }

  try{
    const out = await tx(async (client) => {
      const vk = await client.query('SELECT restricted FROM sync_vault_keys WHERE org_id=$1 AND vault_key=$2 FOR UPDATE', [tokenUser.orgId, vaultKey]);
      if(vk.rowCount !== 1) return { err: { status: 404, msg:'vaultkey-not-found' } };

      const nextRestricted = (restricted === null) ? !!vk.rows[0].restricted : !!restricted;
      await client.query('UPDATE sync_vault_keys SET restricted=$1, updated_at=now() WHERE org_id=$2 AND vault_key=$3', [nextRestricted, tokenUser.orgId, vaultKey]);

      if(!nextRestricted){
        await client.query('DELETE FROM sync_vault_access WHERE org_id=$1 AND vault_key=$2', [tokenUser.orgId, vaultKey]);
      }else{
        await client.query('DELETE FROM sync_vault_access WHERE org_id=$1 AND vault_key=$2', [tokenUser.orgId, vaultKey]);
        for(const g of grants){
          const userId = String(g.userId);
          const perm = String(g.perm||'viewer');
          await client.query('INSERT INTO sync_vault_access(org_id,vault_key,user_id,perm,created_by) VALUES($1,$2,$3,$4,$5)', [tokenUser.orgId, vaultKey, userId, perm, tokenUser.sub]);
        }
        // Ensure actor has editor
        await client.query('INSERT INTO sync_vault_access(org_id,vault_key,user_id,perm,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT (org_id,vault_key,user_id) DO UPDATE SET perm=excluded.perm',
          [tokenUser.orgId, vaultKey, tokenUser.sub, 'editor', tokenUser.sub]);
      }

      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vault.access.set', severity:'info', detail:{ vaultKey, restricted: nextRestricted, grants: grants.map(g=>({userId:g.userId, perm:g.perm||'viewer'})) } });
      return { ok:true, restricted: nextRestricted };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, { ok:true, vaultKey, restricted: out.restricted });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
