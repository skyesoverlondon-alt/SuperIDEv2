const { tx, query } = require('./_db');
const { json, ok, bad, preflight, jwtSign, verifyEcdsa, uuid } = require('./_util');
const { rateLimitIp, rateLimitUser } = require('./_rate');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');
const { generateAuthenticationOptions, verifyAuthenticationResponse, rpId, expectedOrigin } = require('./_webauthn');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const orgId = String(body.orgId||'').trim();
  const userId = String(body.userId||'').trim();
  const challengeId = String(body.challengeId||'').trim();
  const signatureB64 = String(body.signatureB64||'').trim();
  const deviceId = String(body.deviceId||'').trim().slice(0,80) || null;
  if(!orgId || !userId || !challengeId || !signatureB64) return bad(event, 400, 'missing-fields');

  // Protect verify endpoint from brute force/spam.
  try{
    const r1 = await rateLimitIp(event, 'verify', 40, 60);
    if(!r1.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r1.retryAfterSec });
    const r2 = await rateLimitUser(event, 'verify-user', orgId, userId, 60, 60);
    if(!r2.ok) return bad(event, 429, 'rate-limited', { retryAfterSec: r2.retryAfterSec });
  }catch(_){
    return bad(event, 500, 'rate-limit-error');
  }

  try{
    const ch = await query('SELECT id, org_id, user_id, device_id, nonce, expires_at, used FROM sync_challenges WHERE id=$1 AND org_id=$2 AND user_id=$3', [challengeId, orgId, userId]);
    if(ch.rowCount !== 1) return bad(event, 404, 'challenge-not-found');
    const row = ch.rows[0];
    if(row.used) return bad(event, 409, 'challenge-used');
    if(new Date(row.expires_at).getTime() < Date.now()) return bad(event, 410, 'challenge-expired');
    if(row.device_id && deviceId && String(row.device_id) !== String(deviceId)) return bad(event, 409, 'device-mismatch');

    const u = await query('SELECT id, org_id, role, pubkey_jwk, status, COALESCE(token_version,1) as token_version FROM sync_users WHERE id=$1 AND org_id=$2', [userId, orgId]);
    if(u.rowCount !== 1) return bad(event, 404, 'user-not-found');
    if(u.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    const org = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, policy, key_model FROM sync_orgs WHERE id=$1', [orgId]);
    if(org.rowCount !== 1) return bad(event, 404, 'org-not-found');
    const orgEpoch = Number(org.rows[0].key_epoch||1);
    const tokenVersion = Number(org.rows[0].token_version||1);
    const keyModel = String(org.rows[0].key_model||'wrapped-epoch-vault-v1');
    const policy = normalizePolicy(org.rows[0].policy || {});

    // Enforce IP allowlist if configured
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }

    // Enforce deviceId if required
    if(policy.requireDeviceId && !deviceId) return bad(event, 400, 'deviceId-required');

    // Ensure epoch history exists (idempotent)
    try{
      await query('INSERT INTO sync_org_epochs(org_id,epoch,org_salt_b64,org_kdf_iterations) VALUES($1,$2,$3,$4) ON CONFLICT (org_id,epoch) DO NOTHING', [orgId, orgEpoch, org.rows[0].org_salt_b64, org.rows[0].org_kdf_iterations]);
    }catch(_){ /* ignore */ }

    const okSig = await verifyEcdsa(u.rows[0].pubkey_jwk, row.nonce, signatureB64);
    if(!okSig){
      // Best-effort audit on failure
      try{ await tx(async (client)=>{ await auditTx(client, event, { orgId, userId, deviceId, action:'auth.verify.fail', severity:'warn', detail:{} }); }); }catch(_){ /* ignore */ }
      return bad(event, 403, 'bad-signature');
    }

    // ---------- Optional hardware-backed key attestation (WebAuthn) ----------
    const wpol = (policy.webauthn && typeof policy.webauthn === 'object') ? policy.webauthn : {};
    const requireForLogin = !!wpol.requireForLogin;
    const enforceEnrollment = !!wpol.enforceEnrollment;

    let creds = null;
    if(requireForLogin || enforceEnrollment){
      creds = await query('SELECT credential_id_b64url, public_key_b64, counter, compromised FROM sync_webauthn_creds WHERE org_id=$1 AND user_id=$2 AND compromised=false', [orgId, userId]);
      if(creds.rowCount === 0 && enforceEnrollment){
        return bad(event, 403, 'webauthn-not-enrolled');
      }

      if(requireForLogin && creds.rowCount > 0){
        const provided = body.webauthn || null;
        if(!provided || !provided.challengeId || !provided.response){
          // Issue authn options (challenge) and require a second POST to this endpoint.
          const opts = await generateAuthenticationOptions({
            rpID: rpId(event),
            userVerification: (wpol.userVerification || 'preferred'),
            allowCredentials: creds.rows.map(c=>({ id: String(c.credential_id_b64url), type:'public-key' }))
          });

          const waChId = uuid();
          const exp = new Date(Date.now() + 5*60*1000);
          await query('INSERT INTO sync_webauthn_challenges(id,org_id,user_id,type,challenge_b64url,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [waChId, orgId, userId, 'auth', opts.challenge, exp.toISOString()]);
          return bad(event, 409, 'webauthn-required', { webauthn: { challengeId: waChId, publicKey: opts } });
        }

        const waChId = String(provided.challengeId||'').trim();
        const waResp = provided.response;
        if(!waChId || !waResp) return bad(event, 400, 'bad-webauthn');

        const ch2 = await query('SELECT id, challenge_b64url, expires_at, used, type FROM sync_webauthn_challenges WHERE id=$1 AND org_id=$2 AND user_id=$3', [waChId, orgId, userId]);
        if(ch2.rowCount !== 1) return bad(event, 404, 'webauthn-challenge-not-found');
        if(ch2.rows[0].used) return bad(event, 409, 'webauthn-challenge-used');
        if(String(ch2.rows[0].type||'') !== 'auth') return bad(event, 400, 'bad-webauthn-challenge-type');
        if(new Date(ch2.rows[0].expires_at).getTime() < Date.now()) return bad(event, 410, 'webauthn-challenge-expired');

        // Identify credential
        const credId = String(waResp.id || waResp.rawId || '').trim();
        const found = creds.rows.find(c=>String(c.credential_id_b64url) === credId);
        if(!found) return bad(event, 403, 'webauthn-unknown-credential');

        const verification = await verifyAuthenticationResponse({
          response: waResp,
          expectedChallenge: String(ch2.rows[0].challenge_b64url),
          expectedOrigin: expectedOrigin(event),
          expectedRPID: rpId(event),
          requireUserVerification: (String(wpol.userVerification||'').toLowerCase() === 'required'),
          authenticator: {
            credentialID: credId,
            credentialPublicKey: Buffer.from(String(found.public_key_b64), 'base64'),
            counter: Number(found.counter||0)
          }
        });

        if(!verification.verified) return bad(event, 403, 'webauthn-not-verified');

        await tx(async (client)=>{
          await client.query('UPDATE sync_webauthn_challenges SET used=true WHERE id=$1', [waChId]);
          await client.query('UPDATE sync_webauthn_creds SET counter=$1, last_used_at=now() WHERE org_id=$2 AND user_id=$3 AND credential_id_b64url=$4', [Number(verification.authenticationInfo.newCounter||0), orgId, userId, credId]);
          await auditTx(client, event, { orgId, userId, deviceId, action:'webauthn.auth.verify', severity:'info', detail:{ credId } });
        });
      }
    }

    // Mark used + audit in one transaction
    await tx(async (client)=>{
      await client.query('UPDATE sync_challenges SET used=true WHERE id=$1', [challengeId]);
      await client.query('UPDATE sync_users SET last_login_at=now() WHERE id=$1 AND org_id=$2', [userId, orgId]);
      await auditTx(client, event, { orgId, userId, deviceId, action:'auth.verify', severity:'info', detail:{} });
    });

    const now = Math.floor(Date.now()/1000);
    const ttl = Number(policy.sessionTtlSec || (7*24*3600));
    const exp = now + Math.min(ttl, (7*24*3600));
    const userTokenVersion = Number(u.rows[0].token_version||1);
    const token = jwtSign({ sub: userId, orgId, role: u.rows[0].role, did: deviceId || undefined, tv: tokenVersion, uv: userTokenVersion, epoch: orgEpoch, iat: now, exp });

    return ok(event, { token, role: u.rows[0].role, keyModel, orgSaltB64: org.rows[0].org_salt_b64, orgKdfIterations: org.rows[0].org_kdf_iterations, orgEpoch, tokenVersion, userTokenVersion, policy, webauthn: { enrolled: !!(creds && creds.rowCount) } });
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
