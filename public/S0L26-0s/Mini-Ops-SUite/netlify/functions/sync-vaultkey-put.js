const { tx, query } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

function validWrap(w){
  if(!w || typeof w !== 'object') return false;
  if(typeof w.ivB64 !== 'string' || typeof w.dataB64 !== 'string') return false;
  if(w.ivB64.length < 8 || w.ivB64.length > 64) return false;
  if(w.dataB64.length < 16 || w.dataB64.length > 2048) return false;
  return true;
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
  const epoch = Number(body.epoch||0);
  const wrap = body.wrap;
  const restricted = (typeof body.restricted === 'boolean') ? body.restricted : null;
  const rotate = !!body.rotate; // if true: bump key_rev (new vault key material)

  if(!vaultKey) return bad(event, 400, 'vaultKey-required');
  if(!Number.isFinite(epoch) || epoch < 1) return bad(event, 400, 'bad-epoch');
  if(!validWrap(wrap)) return bad(event, 400, 'bad-wrap');

  // Org info authoritative
  let orgInfo = null;
  try{
    const org = await query('SELECT key_epoch, token_version, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    orgInfo = {
      orgEpoch: Number(org.rows[0].key_epoch||1),
      tokenVersion: Number(org.rows[0].token_version||1),
      policy: normalizePolicy(org.rows[0].policy || {})
    };
    const tv = Number(tokenUser.tv||0);
    if(tv && tv !== orgInfo.tokenVersion) return bad(event, 401, 'token-stale', orgInfo);

    const ip = getClientIp(event);
    const pol = orgInfo.policy || {};
    if((pol.requireIpAllowlist || (pol.ipAllowlist && pol.ipAllowlist.length)) && !ipInAllowlist(ip, pol.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  if(epoch !== orgInfo.orgEpoch) return bad(event, 409, 'org-epoch-mismatch', orgInfo);

  // Verify role/status from DB
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
  if(rotate && (dbRole !== 'owner' && dbRole !== 'admin')) return bad(event, 403, 'owner-or-admin-required');

  try{
    const out = await tx(async (client) => {
      const existing = await client.query('SELECT restricted, key_rev FROM sync_vault_keys WHERE org_id=$1 AND vault_key=$2 FOR UPDATE', [tokenUser.orgId, vaultKey]);
      const exists = existing.rowCount === 1;
      const wasRestricted = exists ? !!existing.rows[0].restricted : false;
      const curKeyRev = exists ? Number(existing.rows[0].key_rev||1) : 0;

      const wantsRestricted = (restricted === null) ? wasRestricted : !!restricted;

      if(wasRestricted !== wantsRestricted){
        if(dbRole !== 'owner' && dbRole !== 'admin'){
          return { err: { status: 403, msg: 'owner-or-admin-required' } };
        }
      }
      if(wantsRestricted && (dbRole !== 'owner' && dbRole !== 'admin')){
        return { err: { status: 403, msg: 'owner-or-admin-required' } };
      }

      let keyRev = 1;
      if(!exists){
        const ins = await client.query(
          'INSERT INTO sync_vault_keys(org_id,vault_key,epoch,key_rev,wrap,restricted,created_by,created_at,updated_at) VALUES($1,$2,$3,1,$4,$5,$6,now(),now()) RETURNING key_rev',
          [tokenUser.orgId, vaultKey, epoch, wrap, wantsRestricted, tokenUser.sub]
        );
        keyRev = Number(ins.rows[0].key_rev||1);

        if(wantsRestricted){
          await client.query(
            'INSERT INTO sync_vault_access(org_id,vault_key,user_id,perm,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT (org_id,vault_key,user_id) DO UPDATE SET perm=excluded.perm',
            [tokenUser.orgId, vaultKey, tokenUser.sub, 'editor', tokenUser.sub]
          );
        }

        await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vaultkey.create', severity:'info', detail:{ vaultKey, epoch, restricted: wantsRestricted, keyRev } });
      }else{
        if(rotate){
          const upd = await client.query(
            'UPDATE sync_vault_keys SET epoch=$1, wrap=$2, restricted=$3, key_rev=key_rev+1, updated_at=now() WHERE org_id=$4 AND vault_key=$5 RETURNING key_rev',
            [epoch, wrap, wantsRestricted, tokenUser.orgId, vaultKey]
          );
          keyRev = Number(upd.rows[0].key_rev|| (curKeyRev+1));
          await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vaultkey.rotate', severity:'info', detail:{ vaultKey, epoch, restricted: wantsRestricted, keyRev } });
        }else{
          const upd = await client.query(
            'UPDATE sync_vault_keys SET epoch=$1, wrap=$2, restricted=$3, updated_at=now() WHERE org_id=$4 AND vault_key=$5 RETURNING key_rev',
            [epoch, wrap, wantsRestricted, tokenUser.orgId, vaultKey]
          );
          keyRev = Number(upd.rows[0].key_rev||curKeyRev||1);
          await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'vaultkey.update', severity:'info', detail:{ vaultKey, epoch, restricted: wantsRestricted, keyRev } });
        }
      }

      return { ok:true, keyRev };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, { ok:true, vaultKey, epoch, keyRev: out.keyRev, orgEpoch: orgInfo.orgEpoch, tokenVersion: orgInfo.tokenVersion });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
