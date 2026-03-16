const { tx, query } = require('./_db');
const { json, ok, bad, preflight, requireRole, uuid, randCode, inviteHash } = require('./_util');
const { requireCtx } = require('./_authz');
const { rateLimitIp, rateLimitUser } = require('./_rate');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  // Prevent invite spam.
  try{
    const r1 = await rateLimitIp(event, 'invite-create', 20, 60);
    if(!r1.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r1.retryAfterSec });
    const r2 = await rateLimitUser(event, 'invite-create-user', tokenUser.orgId, tokenUser.sub, 30, 60);
    if(!r2.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r2.retryAfterSec });
  }catch(_){
    return bad(event, 500, 'rate-limit-error');
  }

  // Enforce org token version + policy
  let policy = {};
  try{
    const org = await query('SELECT token_version, policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const tv = Number(tokenUser.tv||0);
    const cur = Number(org.rows[0].token_version||1);
    if(tv && tv !== cur) return bad(event, 401, 'token-stale', { tokenVersion: cur });

    policy = normalizePolicy(org.rows[0].policy || {});
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  // Re-check role/status from DB so RBAC changes apply immediately.
  let dbUser = null;
  try{
    const rs = await query('SELECT id, role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(rs.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(rs.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');
    dbUser = { sub: tokenUser.sub, orgId: tokenUser.orgId, role: rs.rows[0].role };
  }catch(_){
    return bad(event, 500, 'db-error');
  }

  if(!requireRole(dbUser, 'admin')) return bad(event, 403, 'forbidden');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const role = String(body.role||'viewer').trim();
  const allowed = ['admin','editor','viewer'];
  if(!allowed.includes(role)) return bad(event, 400, 'bad-role');

  let hrs = Number(body.expiresHours || 72);
  if(!Number.isFinite(hrs) || hrs < 1) hrs = 72;
  if(hrs > 720) hrs = 720;

  const inviteCode = randCode(20);
  const codeHash = inviteHash(inviteCode);
  const id = uuid();
  const exp = new Date(Date.now() + hrs*3600*1000).toISOString();

  try{
    await tx(async (client)=>{
      await client.query('INSERT INTO sync_invites(id,org_id,role,code_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [id, dbUser.orgId, role, codeHash, dbUser.sub, exp]);
      await auditTx(client, event, { orgId: dbUser.orgId, userId: dbUser.sub, deviceId: tokenUser.did||null, action:'invite.create', severity:'info', detail:{ role, expiresHours: hrs } });
    });
    return ok(event, { inviteCode, role, expiresAt: exp });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
