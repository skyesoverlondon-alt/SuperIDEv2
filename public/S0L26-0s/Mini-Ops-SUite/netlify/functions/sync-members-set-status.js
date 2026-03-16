const { tx, query } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');
const { deprovisionUserTx } = require('./_deprovision');

const STATUSES = ['active','revoked'];

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // Enforce org token version + optional IP allowlist
  try{
    const org = await query('SELECT token_version, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const tv = Number(tokenUser.tv||0);
    const cur = Number(org.rows[0].token_version||1);
    if(tv && tv !== cur) return bad(event, 401, 'token-stale', { tokenVersion: cur });

    const policy = normalizePolicy(org.rows[0].policy || {});
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  // Verify caller is active and can manage
  let dbRole = null;
  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    dbRole = me.rows[0].role;
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  if(!requireRole({role: dbRole}, 'admin')) return bad(event, 403, 'forbidden');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const targetUserId = String(body.targetUserId||'').trim();
  const status = String(body.status||'').trim();
  if(!targetUserId || !STATUSES.includes(status)) return bad(event, 400, 'bad-input');

  try{
    const out = await tx(async (client) => {
      const t = await client.query('SELECT id, role, status FROM sync_users WHERE id=$1 AND org_id=$2 FOR UPDATE', [targetUserId, tokenUser.orgId]);
      if(t.rowCount !== 1) return { err: { status: 404, msg: 'user-not-found' } };

      // Prevent revoking the last active owner.
      if(t.rows[0].role === 'owner' && status !== 'active'){
        const owners = await client.query("SELECT count(*)::int AS c FROM sync_users WHERE org_id=$1 AND role='owner' AND status='active'", [tokenUser.orgId]);
        if(Number(owners.rows[0].c||0) <= 1) return { err: { status: 409, msg: 'cannot-revoke-last-owner' } };
      }

      if(status === 'revoked'){
        await deprovisionUserTx(client, event, { orgId: tokenUser.orgId, targetUserId, byUserId: tokenUser.sub, deviceId: tokenUser.did || null, source:'admin', reason:'member-status-revoked' });
      } else {
        await client.query("UPDATE sync_users SET status='active', revoked_at=null WHERE id=$1 AND org_id=$2", [targetUserId, tokenUser.orgId]);
      }

      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'member.setStatus', severity:'info', detail:{ targetUserId, status } });
      return { ok: true };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
