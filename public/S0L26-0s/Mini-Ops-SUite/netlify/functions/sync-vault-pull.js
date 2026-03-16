const { tx, query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // Org info (epoch/token version) is authoritative.
  let orgInfo = null;
  try{
    const org = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    orgInfo = {
      orgSaltB64: org.rows[0].org_salt_b64,
      orgKdfIterations: org.rows[0].org_kdf_iterations,
      orgEpoch: Number(org.rows[0].key_epoch||1),
      tokenVersion: Number(org.rows[0].token_version||1),
      policy: normalizePolicy(org.rows[0].policy || {})
    };
    const tv = Number(tokenUser.tv||0);
    if(tv && tv !== orgInfo.tokenVersion) return bad(event, 401, 'token-stale', orgInfo);

    // Enforce optional IP allowlist
    const ip = getClientIp(event);
    const pol = orgInfo.policy || {};
    if((pol.requireIpAllowlist || (pol.ipAllowlist && pol.ipAllowlist.length)) && !ipInAllowlist(ip, pol.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  try{
    const me = await query('SELECT status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const vaultKey = String(body.vaultKey||'').trim();
  const sinceRev = Number(body.sinceRev||0);
  if(!vaultKey) return bad(event, 400, 'vaultKey-required');

// Per-vault access control (optional).
try{
  const vk = await query('SELECT restricted FROM sync_vault_keys WHERE org_id=$1 AND vault_key=$2', [tokenUser.orgId, vaultKey]);
  if(vk.rowCount === 1 && !!vk.rows[0].restricted){
    const a = await query('SELECT perm FROM sync_vault_access WHERE org_id=$1 AND vault_key=$2 AND user_id=$3', [tokenUser.orgId, vaultKey, tokenUser.sub]);
    if(a.rowCount !== 1) return bad(event, 403, 'forbidden');
  }
}catch(_){
  return bad(event, 500, 'db-error');
}

  if(!Number.isFinite(sinceRev) || sinceRev < 0) return bad(event, 400, 'bad-sinceRev');

  try{
    const rs = await query('SELECT rev, epoch, ciphertext_b64, meta, updated_at FROM sync_vaults WHERE org_id=$1 AND vault_key=$2', [tokenUser.orgId, vaultKey]);
    if(rs.rowCount === 0) return ok(event, Object.assign({ upToDate: true, rev: 0, epoch: orgInfo.orgEpoch }, orgInfo));

    const rev = Number(rs.rows[0].rev || 0);
    if(rev <= sinceRev) return ok(event, Object.assign({ upToDate: true, rev, epoch: Number(rs.rows[0].epoch||1) }, orgInfo));

    // Optional audit for reads (policy-controlled)
    const pol = orgInfo.policy || {};
    if(pol.auditVaultReads){
      try{
        await tx(async (client)=>{
          await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vault.pull', severity:'info', detail:{ vaultKey, rev } });
        });
      }catch(_){ /* ignore */ }
    }

    return ok(event, Object.assign({ upToDate: false, rev, epoch: Number(rs.rows[0].epoch||1), ciphertextB64: rs.rows[0].ciphertext_b64, meta: rs.rows[0].meta, updatedAt: rs.rows[0].updated_at }, orgInfo));
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
