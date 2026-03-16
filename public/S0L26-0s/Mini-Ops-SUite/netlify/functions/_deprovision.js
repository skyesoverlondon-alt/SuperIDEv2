const { auditTx } = require('./_audit');

/**
 * Deprovision cascade:
 * - invalidate user sessions via per-user token_version++
 * - delete key wraps + vault grants
 * - remove SCIM memberships
 * - compromise WebAuthn creds
 * - audit
 */
async function deprovisionUserTx(client, event, { orgId, targetUserId, byUserId=null, deviceId=null, source='admin', reason='' } = {}){
  const u = await client.query('SELECT status, token_version FROM sync_users WHERE org_id=$1 AND id=$2 FOR UPDATE', [orgId, targetUserId]);
  if(u.rowCount !== 1) return { ok:false, error:'user-not-found' };

  const nextTv = Number(u.rows[0].token_version || 1) + 1;

  await client.query(
    "UPDATE sync_users SET status='revoked', revoked_at=now(), token_version=$1 WHERE org_id=$2 AND id=$3",
    [nextTv, orgId, targetUserId]
  );

  try{ await client.query('DELETE FROM sync_dek_wraps WHERE org_id=$1 AND user_id=$2', [orgId, targetUserId]); }catch(_){}
  try{ await client.query('DELETE FROM sync_vault_access WHERE org_id=$1 AND user_id=$2', [orgId, targetUserId]); }catch(_){}

  try{ await client.query('DELETE FROM sync_scim_group_members WHERE user_id=$1', [targetUserId]); }catch(_){}

  try{ await client.query('UPDATE sync_webauthn_creds SET compromised=true WHERE org_id=$1 AND user_id=$2', [orgId, targetUserId]); }catch(_){}
  try{ await client.query('DELETE FROM sync_webauthn_challenges WHERE org_id=$1 AND user_id=$2', [orgId, targetUserId]); }catch(_){}

  try{
    await auditTx(client, event, {
      orgId,
      userId: byUserId,
      deviceId,
      action: 'user.deprovision',
      severity: 'warn',
      detail: { targetUserId, source, reason: String(reason||'').slice(0,500), userTokenVersion: nextTv }
    });
  }catch(_){}

  return { ok:true, userTokenVersion: nextTv };
}

module.exports = { deprovisionUserTx };
