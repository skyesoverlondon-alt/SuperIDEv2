const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');

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

  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    const meRole = me.rows[0].role;
    const canManage = requireRole({ role: meRole }, 'admin');

    const orgEpochRs = await query('SELECT key_epoch FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    const orgEpoch = (orgEpochRs.rowCount === 1) ? Number(orgEpochRs.rows[0].key_epoch||1) : 1;

    // Include enc_pubkey_jwk only for owners/admins (needed to grant access by wrapping DEK).
    const sql = canManage
      ? 'SELECT u.id, u.name, u.role, u.status, u.revoked_at, u.created_at, u.enc_pubkey_jwk, (w.user_id is not null) AS dek_ready\n'
        + 'FROM sync_users u\n'
        + 'LEFT JOIN sync_dek_wraps w ON w.org_id=u.org_id AND w.user_id=u.id AND w.epoch=$2\n'
        + 'WHERE u.org_id=$1 ORDER BY u.created_at ASC'
      : 'SELECT u.id, u.name, u.role, u.status, u.revoked_at, u.created_at, (w.user_id is not null) AS dek_ready\n'
        + 'FROM sync_users u\n'
        + 'LEFT JOIN sync_dek_wraps w ON w.org_id=u.org_id AND w.user_id=u.id AND w.epoch=$2\n'
        + 'WHERE u.org_id=$1 ORDER BY u.created_at ASC';

    const rs = await query(sql, [tokenUser.orgId, orgEpoch]);

    return ok(event, {
      orgEpoch,
      members: rs.rows.map(r=>({
        id: r.id,
        name: r.name,
        role: r.role,
        status: r.status,
        revokedAt: r.revoked_at,
        createdAt: r.created_at,
        dekReady: !!r.dek_ready,
        encPubKeyJwk: (canManage ? r.enc_pubkey_jwk : null)
      }))
    });
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
