const { query } = require('./_db');
const { ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  try{
    const org = await query('SELECT key_epoch, token_version, key_model FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const orgEpoch = Number(org.rows[0].key_epoch||1);
    const tokenVersion = Number(org.rows[0].token_version||1);
    const keyModel = org.rows[0].key_model || 'passphrase-v1';

    if(keyModel !== 'wrapped-dek-v1' && keyModel !== 'wrapped-epoch-vault-v1') return bad(event, 409, 'org-legacy-keymodel', { keyModel, orgEpoch, tokenVersion });

    const tv = Number(tokenUser.tv||0);
    if(tv && tv !== tokenVersion) return bad(event, 401, 'token-stale', { orgEpoch, tokenVersion });

    const me = await query('SELECT status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    const w = await query('SELECT wrap FROM sync_dek_wraps WHERE org_id=$1 AND epoch=$2 AND user_id=$3', [tokenUser.orgId, orgEpoch, tokenUser.sub]);
    if(w.rowCount !== 1) return bad(event, 409, 'dek-not-granted', { orgEpoch });

    return ok(event, { ok:true, orgEpoch, keyModel, wrap: w.rows[0].wrap });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
