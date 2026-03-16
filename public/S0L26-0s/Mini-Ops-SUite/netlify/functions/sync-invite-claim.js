const { tx } = require('./_db');
const { json, ok, bad, preflight, uuid, inviteHash, jwtSign } = require('./_util');
const { rateLimitIp } = require('./_rate');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const inviteCode = String(body.inviteCode||'').trim();
  const userName = String(body.userName||'').trim().slice(0,80);
  const deviceId = String(body.deviceId||'').trim().slice(0,80) || null;
  const authPubKeyJwk = body.authPubKeyJwk || body.pubKeyJwk;
  const encPubKeyJwk = body.encPubKeyJwk;

  if(!inviteCode || !userName) return bad(event, 400, 'inviteCode-and-userName-required');

  // Prevent invite brute force / spray.
  try{
    const r = await rateLimitIp(event, 'invite-claim', 30, 60);
    if(!r.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r.retryAfterSec });
  }catch(_){
    return bad(event, 500, 'rate-limit-error');
  }
  if(!authPubKeyJwk || authPubKeyJwk.kty !== 'EC' || authPubKeyJwk.crv !== 'P-256') return bad(event, 400, 'bad-auth-pubkey');
  if(!encPubKeyJwk || encPubKeyJwk.kty !== 'EC' || encPubKeyJwk.crv !== 'P-256') return bad(event, 400, 'bad-enc-pubkey');

  const codeHash = inviteHash(inviteCode);

  try{
    const out = await tx(async (client) => {
      const inv = await client.query('SELECT * FROM sync_invites WHERE code_hash=$1 FOR UPDATE', [codeHash]);
      if(inv.rowCount !== 1) return { err: { status: 404, msg: 'invite-not-found' } };
      const row = inv.rows[0];
      if(row.used_by) return { err: { status: 409, msg: 'invite-used' } };
      if(new Date(row.expires_at).getTime() < Date.now()) return { err: { status: 410, msg: 'invite-expired' } };

      const org = await client.query('SELECT id, org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1', [row.org_id]);
      if(org.rowCount !== 1) return { err: { status: 404, msg: 'org-not-found' } };

      const policy = normalizePolicy(org.rows[0].policy || {});
      const ip = getClientIp(event);
      if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
        return { err: { status: 403, msg: 'ip-not-allowed' } };
      }
      if(policy.requireDeviceId && !deviceId) return { err: { status: 400, msg: 'deviceId-required' } };

      // Ensure epoch history exists (idempotent)
      await client.query('INSERT INTO sync_org_epochs(org_id,epoch,org_salt_b64,org_kdf_iterations) VALUES($1,$2,$3,$4) ON CONFLICT (org_id,epoch) DO NOTHING', [row.org_id, Number(org.rows[0].key_epoch||1), org.rows[0].org_salt_b64, org.rows[0].org_kdf_iterations]);

      const userId = uuid();
      await client.query('INSERT INTO sync_users(id,org_id,name,role,pubkey_jwk,enc_pubkey_jwk) VALUES($1,$2,$3,$4,$5,$6)', [userId, row.org_id, userName, row.role, authPubKeyJwk, encPubKeyJwk]);
      await client.query('UPDATE sync_invites SET used_by=$1, used_at=now() WHERE id=$2', [userId, row.id]);
      await auditTx(client, event, { orgId: row.org_id, userId, deviceId, action: 'invite.claim', severity: 'info', detail: { role: row.role } });

      const now = Math.floor(Date.now()/1000);
      const orgEpoch = Number(org.rows[0].key_epoch||1);
      const tokenVersion = Number(org.rows[0].token_version||1);
      const ttl = Number(policy.sessionTtlSec || (7*24*3600));
      const exp = now + Math.min(ttl, (7*24*3600));
      const token = jwtSign({ sub: userId, orgId: row.org_id, role: row.role, did: deviceId || undefined, tv: tokenVersion, uv: 1, epoch: orgEpoch, iat: now, exp });

      return { userId, orgId: row.org_id, role: row.role, token, orgSaltB64: org.rows[0].org_salt_b64, orgKdfIterations: org.rows[0].org_kdf_iterations, orgEpoch, tokenVersion, keyModel: org.rows[0].key_model || 'passphrase-v1', policy };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
