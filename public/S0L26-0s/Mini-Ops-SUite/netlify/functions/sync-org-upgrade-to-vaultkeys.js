const { tx, query } = require('./_db');
const { ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // owner only
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
      const org = await client.query('SELECT key_epoch, token_version, key_model FROM sync_orgs WHERE id=$1 FOR UPDATE', [tokenUser.orgId]);
      if(org.rowCount !== 1) return { err: { status: 404, msg: 'org-not-found' } };

      const curModel = String(org.rows[0].key_model||'passphrase-v1');
      const tokenVersion = Number(org.rows[0].token_version||1) + 1;

      await client.query('UPDATE sync_orgs SET key_model=$1, token_version=$2, rotated_at=now() WHERE id=$3', ['wrapped-epoch-vault-v1', tokenVersion, tokenUser.orgId]);
      await client.query('INSERT INTO sync_audit(org_id,user_id,action,detail) VALUES($1,$2,$3,$4)', [tokenUser.orgId, tokenUser.sub, 'org.upgrade.keyModel', { from: curModel, to: 'wrapped-epoch-vault-v1' }]);

      return {
        keyModel: 'wrapped-epoch-vault-v1',
        orgEpoch: Number(org.rows[0].key_epoch||1),
        tokenVersion
      };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, { ok:true, keyModel: out.keyModel, orgEpoch: out.orgEpoch, tokenVersion: out.tokenVersion });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
