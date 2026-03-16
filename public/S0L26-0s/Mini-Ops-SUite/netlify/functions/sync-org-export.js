const zlib = require('zlib');
const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { auditTx } = require('./_audit');

function b64(buf){ return Buffer.from(buf).toString('base64'); }

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
    if(!requireRole({role: me.rows[0].role}, 'owner')) return bad(event, 403, 'forbidden');

    const org = await query('SELECT id,name,key_model,key_epoch,token_version,policy,created_at,rotated_at FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 404, 'org-not-found');

    const users = await query('SELECT id,name,role,status,created_at,revoked_at,pubkey_jwk,enc_pubkey_jwk FROM sync_users WHERE org_id=$1 ORDER BY created_at ASC', [tokenUser.orgId]);
    const epochs = await query('SELECT epoch,org_salt_b64,org_kdf_iterations,created_at FROM sync_org_epochs WHERE org_id=$1 ORDER BY epoch ASC', [tokenUser.orgId]);
    const wraps = await query('SELECT epoch,user_id,wrap,created_by,created_at FROM sync_dek_wraps WHERE org_id=$1 ORDER BY epoch ASC', [tokenUser.orgId]);
    const vkeys = await query('SELECT vault_key,epoch,key_rev,wrap,restricted,created_by,created_at,updated_at FROM sync_vault_keys WHERE org_id=$1 ORDER BY vault_key ASC', [tokenUser.orgId]);
    const vacc = await query('SELECT vault_key,user_id,perm,created_by,created_at FROM sync_vault_access WHERE org_id=$1 ORDER BY vault_key ASC', [tokenUser.orgId]);
    const vaults = await query('SELECT vault_key,epoch,rev,ciphertext_b64,meta,updated_by,updated_at FROM sync_vaults WHERE org_id=$1 ORDER BY vault_key ASC', [tokenUser.orgId]);

    const payload = {
      format: 'skye-sync-export/v1',
      exportedAt: new Date().toISOString(),
      org: org.rows[0],
      users: users.rows,
      orgEpochs: epochs.rows,
      dekWraps: wraps.rows,
      vaultKeys: vkeys.rows,
      vaultAccess: vacc.rows,
      vaults: vaults.rows
    };

    const jsonBuf = Buffer.from(JSON.stringify(payload));
    // Safety: cap exports to avoid function response limits.
    if(jsonBuf.length > 7_500_000) return bad(event, 413, 'export-too-large', { bytes: jsonBuf.length });

    const gz = zlib.gzipSync(jsonBuf, { level: 9 });

    // Audit (best-effort)
    try{
      const { tx } = require('./_db');
      await tx(async (client)=>{
        await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'org.export', severity:'info', detail:{ bytes: jsonBuf.length } });
      });
    }catch(_){ /* ignore */ }

    return ok(event, { ok:true, compressed:true, gzipB64: b64(gz), bytes: jsonBuf.length });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
