const crypto = require('crypto');
const { tx, query } = require('./_db');
const { ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');

// Owner-only: switch org from passphrase-v1 to wrapped-dek-v1, bump epoch + tokenVersion.
exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // Caller must be active owner
  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    if(me.rows[0].role !== 'owner') return bad(event, 403, 'owner-required');
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  try{
    const out = await tx(async (client) => {
      const org = await client.query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model FROM sync_orgs WHERE id=$1 FOR UPDATE', [tokenUser.orgId]);
      if(org.rowCount !== 1) return { err: { status: 404, msg: 'org-not-found' } };

      const curModel = org.rows[0].key_model || 'passphrase-v1';
      if(curModel === 'wrapped-dek-v1') return { err: { status: 409, msg: 'already-wrapped-dek' } };

      const curEpoch = Number(org.rows[0].key_epoch||1);
      const newEpoch = curEpoch + 1;
      const iter = Number(org.rows[0].org_kdf_iterations || 250000);
      const newSalt = crypto.randomBytes(16).toString('base64');
      const newTokenVersion = Number(org.rows[0].token_version||1) + 1;

      await client.query(
        'UPDATE sync_orgs SET key_model=$1, org_salt_b64=$2, org_kdf_iterations=$3, key_epoch=$4, token_version=$5, rotated_at=now() WHERE id=$6',
        ['wrapped-dek-v1', newSalt, iter, newEpoch, newTokenVersion, tokenUser.orgId]
      );

      await client.query('INSERT INTO sync_org_epochs(org_id,epoch,org_salt_b64,org_kdf_iterations) VALUES($1,$2,$3,$4) ON CONFLICT (org_id,epoch) DO NOTHING', [tokenUser.orgId, newEpoch, newSalt, iter]);
      await client.query('INSERT INTO sync_audit(org_id,user_id,action,detail) VALUES($1,$2,$3,$4)', [tokenUser.orgId, tokenUser.sub, 'org.migrateToWrappedDEK', { fromModel: curModel, toModel: 'wrapped-dek-v1', fromEpoch: curEpoch, toEpoch: newEpoch }]);

      return {
        ok: true,
        orgId: tokenUser.orgId,
        keyModel: 'wrapped-dek-v1',
        orgSaltB64: newSalt,
        orgKdfIterations: iter,
        orgEpoch: newEpoch,
        tokenVersion: newTokenVersion
      };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
