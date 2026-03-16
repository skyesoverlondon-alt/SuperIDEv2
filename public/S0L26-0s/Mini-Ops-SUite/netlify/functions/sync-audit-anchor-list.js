const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'GET') return bad(event, 405, 'method-not-allowed');

  const user = authUser(event);
  if(!user) return bad(event, 401, 'unauthorized');
  if(!requireRole(user, 'admin')) return bad(event, 403, 'forbidden');

  const q = event.queryStringParameters || {};
  const limit = Math.max(1, Math.min(365, Number(q.limit||30)));

  try{
    const r = await query(
      'SELECT day, root_hash, alg, key_id, signature_b64, created_at FROM sync_audit_anchors WHERE org_id=$1 ORDER BY day DESC LIMIT $2',
      [user.orgId, limit]
    );
    return ok(event, { anchors: r.rows });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
