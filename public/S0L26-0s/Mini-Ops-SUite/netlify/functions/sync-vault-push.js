const { tx, query } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

function clampMeta(meta){
  if(!meta || typeof meta !== 'object') return null;
  const out = {};
  if(meta.updatedAt) out.updatedAt = String(meta.updatedAt).slice(0,40);
  if(typeof meta.localEncrypted === 'boolean') out.localEncrypted = meta.localEncrypted;
  if(meta.vaultFormat) out.vaultFormat = String(meta.vaultFormat).slice(0,32);
  if(meta.vaultKeyRev !== undefined && meta.vaultKeyRev !== null){
    const n = Number(meta.vaultKeyRev);
    if(Number.isFinite(n) && n > 0) out.vaultKeyRev = n;
  }
  return out;
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // Org info (epoch/token version) is authoritative.
  let orgInfo = null;
  try{
    const org = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    orgInfo = {
      orgSaltB64: org.rows[0].org_salt_b64,
      orgKdfIterations: org.rows[0].org_kdf_iterations,
      orgEpoch: Number(org.rows[0].key_epoch||1),
      tokenVersion: Number(org.rows[0].token_version||1),
      keyModel: String(org.rows[0].key_model||'wrapped-epoch-vault-v1'),
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

  // Verify role/status from DB (RBAC is authoritative server-side).
  let dbRole = null;
  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    dbRole = me.rows[0].role;
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  if(!requireRole({role: dbRole}, 'editor')) return bad(event, 403, 'forbidden');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const vaultKey = String(body.vaultKey||'').trim();
  const baseRev = Number(body.baseRev||0);
  const ciphertextB64 = String(body.ciphertextB64||'').trim();
  const meta = clampMeta(body.meta);
  const orgEpoch = Number(body.orgEpoch || body.epoch || 0);

  if(!vaultKey) return bad(event, 400, 'vaultKey-required');
  if(!Number.isFinite(baseRev) || baseRev < 0) return bad(event, 400, 'bad-baseRev');
  if(!ciphertextB64) return bad(event, 400, 'ciphertext-required');
  const pol = orgInfo.policy || {};
  const maxBytes = Number(pol.maxCiphertextBytes || 5_500_000);
  if(ciphertextB64.length > maxBytes) return bad(event, 413, 'ciphertext-too-large', { maxCiphertextBytes: maxBytes });
  if(!Number.isFinite(orgEpoch) || orgEpoch < 1) return bad(event, 400, 'bad-orgEpoch');
  if(orgEpoch !== orgInfo.orgEpoch) return bad(event, 409, 'org-epoch-mismatch', orgInfo);

  // Per-vault access control (optional) + key revision enforcement.
  // Critical production safety: after a vault key rotation, stale devices must not overwrite
  // the canonical ciphertext with data encrypted under an old VDEK.
  let serverKeyRev = null;
  try{
    const vk = await query('SELECT restricted, key_rev FROM sync_vault_keys WHERE org_id=$1 AND vault_key=$2', [tokenUser.orgId, vaultKey]);

    // If the org uses per-vault keys, a vault key record must exist.
    if(orgInfo.keyModel === 'wrapped-epoch-vault-v1'){
      if(vk.rowCount !== 1) return bad(event, 409, 'vaultkey-missing', { requiredKeyRev: 1, orgEpoch: orgInfo.orgEpoch, tokenVersion: orgInfo.tokenVersion });
      serverKeyRev = Number(vk.rows[0].key_rev||1);
      const clientKeyRev = meta && Number.isFinite(Number(meta.vaultKeyRev)) ? Number(meta.vaultKeyRev) : null;
      if(!clientKeyRev) return bad(event, 400, 'vaultKeyRev-required', { requiredKeyRev: serverKeyRev });
      if(clientKeyRev < serverKeyRev) return bad(event, 409, 'vaultkey-stale', { requiredKeyRev: serverKeyRev });
      if(clientKeyRev > serverKeyRev) return bad(event, 409, 'vaultkey-ahead', { requiredKeyRev: serverKeyRev });
    }

    if(vk.rowCount === 1 && !!vk.rows[0].restricted){
      const a = await query('SELECT perm FROM sync_vault_access WHERE org_id=$1 AND vault_key=$2 AND user_id=$3', [tokenUser.orgId, vaultKey, tokenUser.sub]);
      if(a.rowCount !== 1 || a.rows[0].perm !== 'editor') return bad(event, 403, 'forbidden');
    }
  }catch(_){
    return bad(event, 500, 'db-error');
  }


  try{
    const out = await tx(async (client) => {
      const cur = await client.query('SELECT rev, epoch, ciphertext_b64, meta, updated_at FROM sync_vaults WHERE org_id=$1 AND vault_key=$2 FOR UPDATE', [tokenUser.orgId, vaultKey]);
      if(cur.rowCount === 0){
        if(baseRev !== 0) return { err: { status: 409, msg: 'conflict', current: { rev: 0 } } };
        const newRev = 1;
        await client.query('INSERT INTO sync_vaults(org_id,vault_key,epoch,rev,ciphertext_b64,meta,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [tokenUser.orgId, vaultKey, orgEpoch, newRev, ciphertextB64, meta, tokenUser.sub]);
        await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vault.push', severity:'info', detail:{ vaultKey, rev: newRev } });
        return { rev: newRev };
      }

      const currentRev = Number(cur.rows[0].rev || 0);
      if(baseRev !== currentRev){
        return {
          err: {
            status: 409,
            msg: 'conflict',
            current: {
              rev: currentRev,
              epoch: Number(cur.rows[0].epoch||1),
              ciphertextB64: cur.rows[0].ciphertext_b64,
              meta: cur.rows[0].meta,
              updatedAt: cur.rows[0].updated_at
            }
          }
        };
      }

      const newRev = currentRev + 1;
      await client.query('UPDATE sync_vaults SET epoch=$1, rev=$2, ciphertext_b64=$3, meta=$4, updated_by=$5, updated_at=now() WHERE org_id=$6 AND vault_key=$7', [orgEpoch, newRev, ciphertextB64, meta, tokenUser.sub, tokenUser.orgId, vaultKey]);
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vault.push', severity:'info', detail:{ vaultKey, rev: newRev } });
      return { rev: newRev };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg, Object.assign({ current: out.err.current }, orgInfo || {}));
    return ok(event, Object.assign(out, orgInfo, { orgEpoch: orgInfo.orgEpoch }));
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
