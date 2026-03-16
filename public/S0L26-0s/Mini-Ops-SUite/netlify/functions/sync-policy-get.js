const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { normalizePolicy } = require('./_security');

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

    const org = await query('SELECT policy, token_version, key_epoch, key_model FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 404, 'org-not-found');

    const policy = normalizePolicy(org.rows[0].policy || {});
    return ok(event, {
      ok: true,
      policy,
      tokenVersion: Number(org.rows[0].token_version||1),
      orgEpoch: Number(org.rows[0].key_epoch||1),
      keyModel: String(org.rows[0].key_model||'wrapped-epoch-vault-v1')
    });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
