const crypto = require('crypto');
const { tx, query } = require('./_db');
const { ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

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
      const org = await client.query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1 FOR UPDATE', [tokenUser.orgId]);
      if(org.rowCount !== 1) return { err: { status: 404, msg: 'org-not-found' } };

      const policy = normalizePolicy(org.rows[0].policy || {});
      const ip = getClientIp(event);
      if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
        return { err: { status: 403, msg: 'ip-not-allowed' } };
      }

      const curEpoch = Number(org.rows[0].key_epoch||1);
      const newEpoch = curEpoch + 1;
      const iter = Number(org.rows[0].org_kdf_iterations || 250000);
      const newSalt = crypto.randomBytes(16).toString('base64');
      const newTokenVersion = Number(org.rows[0].token_version||1) + 1;

      await client.query('UPDATE sync_orgs SET org_salt_b64=$1, org_kdf_iterations=$2, key_epoch=$3, token_version=$4, rotated_at=now() WHERE id=$5', [newSalt, iter, newEpoch, newTokenVersion, tokenUser.orgId]);
      await client.query('INSERT INTO sync_org_epochs(org_id,epoch,org_salt_b64,org_kdf_iterations) VALUES($1,$2,$3,$4) ON CONFLICT (org_id,epoch) DO NOTHING', [tokenUser.orgId, newEpoch, newSalt, iter]);
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'org.rotateKey', severity:'info', detail:{ fromEpoch: curEpoch, toEpoch: newEpoch } });

      return {
        ok: true,
        orgId: tokenUser.orgId,
        orgSaltB64: newSalt,
        orgKdfIterations: iter,
        orgEpoch: newEpoch,
        tokenVersion: newTokenVersion,
        keyModel: org.rows[0].key_model || 'passphrase-v1',
        policy
      };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
