const { query } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');

function clampInt(n, lo, hi, def){
  n = Number(n);
  if(!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event) || {};
  const beforeId = clampInt(body.beforeId, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInt(body.limit, 1, 500, 100);
  const actionPrefix = body.actionPrefix ? String(body.actionPrefix).slice(0, 64) : '';
  const verifyChain = !!body.verifyChain;

  try{
    const me = await query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    if(!requireRole({role: me.rows[0].role}, 'admin')) return bad(event, 403, 'forbidden');

    // Optional IP allowlist
    try{
      const org = await query('SELECT policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
      if(org.rowCount === 1){
        const policy = normalizePolicy(org.rows[0].policy || {});
        const ip = getClientIp(event);
        if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
          return bad(event, 403, 'ip-not-allowed');
        }
      }
    }catch(_){ /* ignore */ }

    const params = [tokenUser.orgId];
    let where = 'org_id=$1';
    if(beforeId && beforeId > 0){
      params.push(beforeId);
      where += ` AND id < $${params.length}`;
    }
    if(actionPrefix){
      params.push(actionPrefix + '%');
      where += ` AND action ILIKE $${params.length}`;
    }
    params.push(limit);

    const rows = await query(
      `SELECT id, user_id, device_id, action, severity, detail, req_id, ip, ua, prev_hash, hash, created_at
       FROM sync_audit
       WHERE ${where}
       ORDER BY id DESC
       LIMIT $${params.length}`,
      params
    );

    const events = rows.rows.map(r=>({
      id: Number(r.id),
      userId: r.user_id,
      deviceId: r.device_id,
      action: r.action,
      severity: r.severity,
      detail: r.detail,
      reqId: r.req_id,
      ip: r.ip,
      ua: r.ua,
      prevHash: r.prev_hash,
      hash: r.hash,
      createdAt: r.created_at
    }));

    let chainOk = null;
    if(verifyChain){
      // Verify internal linkage of the returned slice.
      chainOk = true;
      const asc = [...events].sort((a,b)=>a.id-b.id);
      for(let i=1;i<asc.length;i++){
        const prev = asc[i-1];
        const cur = asc[i];
        if(cur.prevHash && prev.hash && cur.prevHash !== prev.hash){
          chainOk = false;
          break;
        }
      }
    }

    const nextCursor = events.length ? events[events.length-1].id : null;
    return ok(event, { ok:true, events, nextCursor, chainOk });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
