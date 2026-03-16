const { tx } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

function validWrap(w){
  if(!w || typeof w !== 'object') return false;
  if(String(w.format||'') !== 'skye-dek-wrap/v1') return false;
  const eph = w.ephPubJwk;
  if(!eph || eph.kty !== 'EC' || eph.crv !== 'P-256' || typeof eph.x !== 'string' || typeof eph.y !== 'string') return false;
  if(typeof w.saltB64 !== 'string' || typeof w.nonceB64 !== 'string' || typeof w.ctB64 !== 'string') return false;
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

  const epoch = Number(body.epoch||0);
  const wrappings = Array.isArray(body.wrappings) ? body.wrappings : [];
  if(!epoch || !Number.isFinite(epoch)) return bad(event, 400, 'bad-epoch');
  if(!wrappings.length || wrappings.length > 200) return bad(event, 400, 'bad-wrappings');

  for(const item of wrappings){
    if(!item || typeof item !== 'object') return bad(event, 400, 'bad-wrap-item');
    if(!item.userId) return bad(event, 400, 'bad-wrap-userId');
    if(!validWrap(item.wrap)) return bad(event, 400, 'bad-wrap-format');
  }

  try{
    const out = await tx(async (client) => {
      const org = await client.query('SELECT token_version, key_epoch, key_model, policy FROM sync_orgs WHERE id=$1 FOR UPDATE', [tokenUser.orgId]);
      if(org.rowCount !== 1) return { err: { status: 401, msg: 'unauthorized' } };

      const tokenVersion = Number(org.rows[0].token_version||1);
      const curEpoch = Number(org.rows[0].key_epoch||1);
      const keyModel = org.rows[0].key_model || 'passphrase-v1';

      const policy = normalizePolicy(org.rows[0].policy || {});
      const ip = getClientIp(event);
      if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
        return { err: { status: 403, msg: 'ip-not-allowed' } };
      }

      if(keyModel !== 'wrapped-dek-v1' && keyModel !== 'wrapped-epoch-vault-v1') return { err: { status: 409, msg: 'org-legacy-keymodel', extra: { keyModel, orgEpoch: curEpoch, tokenVersion } } };

      const tv = Number(tokenUser.tv||0);
      if(tv && tv !== tokenVersion) return { err: { status: 401, msg: 'token-stale', extra: { tokenVersion, orgEpoch: curEpoch } } };

      const me = await client.query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
      if(me.rowCount !== 1) return { err: { status: 401, msg: 'unauthorized' } };
      if(me.rows[0].status !== 'active') return { err: { status: 403, msg: 'user-disabled' } };
      if(!requireRole({ role: me.rows[0].role }, 'admin')) return { err: { status: 403, msg: 'admin-required' } };

      if(epoch !== curEpoch) return { err: { status: 409, msg: 'org-epoch-mismatch', extra: { orgEpoch: curEpoch, tokenVersion } } };

      let updated = 0;
      for(const item of wrappings){
        const targetId = String(item.userId);
        const wrap = item.wrap;

        const tu = await client.query('SELECT id, status FROM sync_users WHERE id=$1 AND org_id=$2', [targetId, tokenUser.orgId]);
        if(tu.rowCount !== 1) continue;
        if(tu.rows[0].status !== 'active') continue;

        await client.query(
          'INSERT INTO sync_dek_wraps(org_id, epoch, user_id, wrap, created_by) VALUES($1,$2,$3,$4,$5)\n' +
          'ON CONFLICT (org_id, epoch, user_id) DO UPDATE SET wrap=EXCLUDED.wrap, created_by=EXCLUDED.created_by, created_at=now()',
          [tokenUser.orgId, epoch, targetId, wrap, tokenUser.sub]
        );
        updated += 1;
      }

      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'dek.put', severity:'info', detail:{ epoch, count: updated } });
      return { ok:true, updated };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg, out.err.extra);
    return ok(event, out);
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
