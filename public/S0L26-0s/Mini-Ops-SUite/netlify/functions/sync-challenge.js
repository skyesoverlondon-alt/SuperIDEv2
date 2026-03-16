const { query } = require('./_db');
const { json, ok, bad, preflight, uuid, randCode } = require('./_util');
const { rateLimitIp, rateLimitUser } = require('./_rate');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const orgId = String(body.orgId||'').trim();
  const userId = String(body.userId||'').trim();
  const deviceId = String(body.deviceId||'').trim().slice(0,80) || null;
  if(!orgId || !userId) return bad(event, 400, 'orgId-and-userId-required');

  // Basic brute-force protection (no third-party dependencies).
  try{
    const r1 = await rateLimitIp(event, 'challenge', 40, 60);
    if(!r1.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r1.retryAfterSec });
    const r2 = await rateLimitUser(event, 'challenge-user', orgId, userId, 60, 60);
    if(!r2.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r2.retryAfterSec });
  }catch(_){
    return bad(event, 500, 'rate-limit-error');
  }

  try{
    const u = await query('SELECT id, org_id, role, status FROM sync_users WHERE id=$1 AND org_id=$2', [userId, orgId]);
    if(u.rowCount !== 1) return bad(event, 404, 'user-not-found');
    if(u.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    // Enforce optional IP allowlist (Enterprise hardening).
    try{
      const org = await query('SELECT policy FROM sync_orgs WHERE id=$1', [orgId]);
      if(org.rowCount === 1){
        const policy = normalizePolicy(org.rows[0].policy || {});
        const ip = getClientIp(event);
        if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
          return bad(event, 403, 'ip-not-allowed');
        }
      }
    }catch(_){ /* if policy lookup fails, continue; rate limits still protect */ }

    const challengeId = uuid();
    const nonce = randCode(24); // base64url
    const expiresAt = new Date(Date.now() + 5*60*1000).toISOString();

    await query('INSERT INTO sync_challenges(id,org_id,user_id,device_id,nonce,expires_at,used) VALUES($1,$2,$3,$4,$5,$6,false)', [challengeId, orgId, userId, deviceId, nonce, expiresAt]);

    // Best-effort audit (not chained because this endpoint isn't authenticated)
    try{
      const { tx } = require('./_db');
      await tx(async (client)=>{
        await auditTx(client, event, { orgId, userId, deviceId, action:'auth.challenge', severity:'info', detail:{} });
      });
    }catch(_){ /* ignore */ }

    return ok(event, { challengeId, nonce });
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
