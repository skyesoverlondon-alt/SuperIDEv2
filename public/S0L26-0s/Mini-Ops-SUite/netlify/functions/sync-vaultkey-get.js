const { query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');

async function getOrgInfo(orgId){
  const org = await query('SELECT key_epoch, token_version, key_model FROM sync_orgs WHERE id=$1', [orgId]);
  if(org.rowCount !== 1) return null;
  return {
    orgEpoch: Number(org.rows[0].key_epoch||1),
    tokenVersion: Number(org.rows[0].token_version||1),
    keyModel: String(org.rows[0].key_model||'passphrase-v1')
  };
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const vaultKey = String(body.vaultKey||'').trim();
  if(!vaultKey) return bad(event, 400, 'vaultKey-required');

  const orgInfo = await getOrgInfo(tokenUser.orgId);
  if(!orgInfo) return bad(event, 401, 'unauthorized');

  const tv = Number(tokenUser.tv||0);
  if(tv && tv !== orgInfo.tokenVersion) return bad(event, 401, 'token-stale', orgInfo);

  // must be active member
  const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
  if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
  if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

  const vk = await query('SELECT epoch, key_rev, wrap, restricted, updated_at FROM sync_vault_keys WHERE org_id=$1 AND vault_key=$2', [tokenUser.orgId, vaultKey]);
  if(vk.rowCount !== 1) return bad(event, 404, 'vaultkey-not-found');

  const restricted = !!vk.rows[0].restricted;
  let perm = 'viewer';
  if(restricted){
    const a = await query('SELECT perm FROM sync_vault_access WHERE org_id=$1 AND vault_key=$2 AND user_id=$3', [tokenUser.orgId, vaultKey, tokenUser.sub]);
    if(a.rowCount !== 1) return bad(event, 403, 'forbidden');
    perm = a.rows[0].perm;
  }else{
    perm = 'editor'; // unrestricted => treat as full access for decrypted wrapper purposes
  }

  return ok(event, {
    vaultKey,
    epoch: Number(vk.rows[0].epoch||orgInfo.orgEpoch||1),
    keyRev: Number(vk.rows[0].key_rev||1),
    wrap: vk.rows[0].wrap,
    restricted,
    perm,
    updatedAt: vk.rows[0].updated_at,
    orgEpoch: orgInfo.orgEpoch,
    tokenVersion: orgInfo.tokenVersion,
    keyModel: orgInfo.keyModel
  });
};
