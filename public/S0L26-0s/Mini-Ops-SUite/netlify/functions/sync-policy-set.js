const { tx } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const nextPolicyRaw = body.policy;
  const nextPolicy = normalizePolicy(nextPolicyRaw);

  if(nextPolicy.requireIpAllowlist && (!nextPolicy.ipAllowlist || nextPolicy.ipAllowlist.length === 0)){
    return bad(event, 400, 'ipAllowlist-required');
  }

  try{
    const out = await tx(async (client)=>{
      const me = await client.query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
      if(me.rowCount !== 1) return { err: { status: 401, msg: 'unauthorized' } };
      if(me.rows[0].status !== 'active') return { err: { status: 403, msg: 'user-disabled' } };
      if(!requireRole({role: me.rows[0].role}, 'owner')) return { err: { status: 403, msg: 'forbidden' } };

      const org = await client.query('SELECT policy, token_version FROM sync_orgs WHERE id=$1 FOR UPDATE', [tokenUser.orgId]);
      if(org.rowCount !== 1) return { err: { status: 404, msg: 'org-not-found' } };

      const oldPolicy = normalizePolicy(org.rows[0].policy || {});
      const newTv = Number(org.rows[0].token_version||1) + 1;

      await client.query('UPDATE sync_orgs SET policy=$1, token_version=$2 WHERE id=$3', [nextPolicy, newTv, tokenUser.orgId]);

      await auditTx(client, event, {
        orgId: tokenUser.orgId,
        userId: tokenUser.sub,
        deviceId: tokenUser.did || null,
        action: 'policy.set',
        severity: 'info',
        detail: { oldPolicy, newPolicy: nextPolicy, tokenVersion: newTv }
      });

      return { policy: nextPolicy, tokenVersion: newTv };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, { ok: true, policy: out.policy, tokenVersion: out.tokenVersion });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
