const { tx, query } = require('./_db');
const { json, ok, bad, preflight, jwtVerify, jwtSign } = require('./_util');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');
const { verifyAuthenticationResponse, rpId, expectedOrigin } = require('./_webauthn');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const preAuthToken = String(body.preAuthToken||'').trim();
  const wa = body.webauthn || null;
  if(!preAuthToken || !wa || !wa.challengeId || !wa.response) return bad(event, 400, 'missing-fields');

  const pre = jwtVerify(preAuthToken);
  if(!pre || pre.typ !== 'sso-preauth-v1' || pre.sso !== 'saml' || !pre.sub || !pre.orgId) return bad(event, 401, 'unauthorized');

  const orgId = String(pre.orgId);
  const userId = String(pre.sub);
  const deviceId = pre.did ? String(pre.did).slice(0,80) : null;

  try{
    const org = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1', [orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const policy = normalizePolicy(org.rows[0].policy || {});

    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }

    const u = await query('SELECT id, role, status, COALESCE(token_version,1) as token_version FROM sync_users WHERE id=$1 AND org_id=$2', [userId, orgId]);
    if(u.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(u.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    const challengeId = String(wa.challengeId||'').trim();
    const ch = await query('SELECT id, challenge_b64url, expires_at, used, type FROM sync_webauthn_challenges WHERE id=$1 AND org_id=$2 AND user_id=$3', [challengeId, orgId, userId]);
    if(ch.rowCount !== 1) return bad(event, 404, 'challenge-not-found');
    if(ch.rows[0].used) return bad(event, 409, 'challenge-used');
    if(String(ch.rows[0].type||'') !== 'auth') return bad(event, 400, 'bad-challenge-type');
    if(new Date(ch.rows[0].expires_at).getTime() < Date.now()) return bad(event, 410, 'challenge-expired');

    const credId = String(wa.response.id || wa.response.rawId || '').trim();
    if(!credId) return bad(event, 400, 'bad-credential');

    const cred = await query('SELECT credential_id_b64url, public_key_b64, counter, compromised FROM sync_webauthn_creds WHERE org_id=$1 AND user_id=$2 AND credential_id_b64url=$3 AND compromised=false', [orgId, userId, credId]);
    if(cred.rowCount !== 1) return bad(event, 403, 'unknown-credential');

    const w = (policy.webauthn && typeof policy.webauthn === 'object') ? policy.webauthn : {};

    const verification = await verifyAuthenticationResponse({
      response: wa.response,
      expectedChallenge: String(ch.rows[0].challenge_b64url),
      expectedOrigin: expectedOrigin(event),
      expectedRPID: rpId(event),
      requireUserVerification: (String(w.userVerification||'').toLowerCase() === 'required'),
      authenticator: {
        credentialID: credId,
        credentialPublicKey: Buffer.from(String(cred.rows[0].public_key_b64), 'base64'),
        counter: Number(cred.rows[0].counter||0)
      }
    });

    if(!verification.verified) return bad(event, 403, 'webauthn-not-verified');

    await tx(async (client)=>{
      await client.query('UPDATE sync_webauthn_challenges SET used=true WHERE id=$1', [challengeId]);
      await client.query('UPDATE sync_webauthn_creds SET counter=$1, last_used_at=now() WHERE org_id=$2 AND user_id=$3 AND credential_id_b64url=$4', [Number(verification.authenticationInfo.newCounter||0), orgId, userId, credId]);
      await auditTx(client, event, { orgId, userId, deviceId, action:'sso.saml.webauthn', severity:'info', detail:{ credId } });
    });

    const orgEpoch = Number(org.rows[0].key_epoch||1);
    const tokenVersion = Number(org.rows[0].token_version||1);
    const keyModel = String(org.rows[0].key_model||'wrapped-epoch-vault-v1');

    const now = Math.floor(Date.now()/1000);
    const ttl = Number(policy.sessionTtlSec || (24*3600));
    const exp = now + Math.min(ttl, (7*24*3600));
    const userTokenVersion = Number(u.rows[0].token_version||1);
    const token = jwtSign({ sub: userId, orgId, role: u.rows[0].role, did: deviceId || undefined, tv: tokenVersion,
      userTokenVersion, uv: userTokenVersion, epoch: orgEpoch, iat: now, exp });

    return ok(event, {
      token,
      orgId,
      userId,
      role: u.rows[0].role,
      keyModel,
      orgSaltB64: org.rows[0].org_salt_b64,
      orgKdfIterations: org.rows[0].org_kdf_iterations,
      orgEpoch,
      tokenVersion,
      userTokenVersion,
      policy,
      webauthn: { enrolled: true }
    });
  }catch(e){
    return bad(event, 500, 'finalize-failed');
  }
};
