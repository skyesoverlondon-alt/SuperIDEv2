const { tx, query } = require('./_db');
const { json, ok, bad, preflight } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');
const { verifyRegistrationResponse, rpId, expectedOrigin } = require('./_webauthn');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');
  const challengeId = String(body.challengeId||'').trim();
  const response = body.response;
  const deviceId = tokenUser.did || (body.deviceId ? String(body.deviceId).slice(0,80) : null);
  if(!challengeId || !response) return bad(event, 400, 'missing-fields');

  try{
    const org = await query('SELECT policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const policy = normalizePolicy(org.rows[0].policy || {});

    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }

    const me = await query('SELECT status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    const ch = await query('SELECT id, challenge_b64url, expires_at, used, type FROM sync_webauthn_challenges WHERE id=$1 AND org_id=$2 AND user_id=$3', [challengeId, tokenUser.orgId, tokenUser.sub]);
    if(ch.rowCount !== 1) return bad(event, 404, 'challenge-not-found');
    if(ch.rows[0].used) return bad(event, 409, 'challenge-used');
    if(String(ch.rows[0].type||'') !== 'reg') return bad(event, 400, 'bad-challenge-type');
    if(new Date(ch.rows[0].expires_at).getTime() < Date.now()) return bad(event, 410, 'challenge-expired');

    const w = (policy.webauthn && typeof policy.webauthn === 'object') ? policy.webauthn : {};
    const allowed = Array.isArray(w.allowedAAGUIDs) ? w.allowedAAGUIDs.map(s=>String(s).toLowerCase()) : null;

    const expectedRPID = rpId(event);
    const expOrigin = expectedOrigin(event);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: String(ch.rows[0].challenge_b64url),
      expectedOrigin: expOrigin,
      expectedRPID,
      requireUserVerification: (String(w.userVerification||'').toLowerCase() === 'required')
    });

    if(!verification.verified) return bad(event, 403, 'webauthn-not-verified');

    const info = verification.registrationInfo;
    if(!info) return bad(event, 500, 'webauthn-missing-info');

    const aaguid = info.aaguid ? String(info.aaguid).toLowerCase() : '';
    if(allowed && allowed.length && aaguid && !allowed.includes(aaguid)){
      return bad(event, 403, 'webauthn-aaguid-not-allowed');
    }

    // Store credential
    await tx(async (client)=>{
      await client.query('UPDATE sync_webauthn_challenges SET used=true WHERE id=$1', [challengeId]);
      await client.query(
        `INSERT INTO sync_webauthn_creds(org_id,user_id,device_id,credential_id_b64url,public_key_b64,counter,fmt,aaguid,attestation,transports,is_platform)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (org_id, credential_id_b64url) DO UPDATE SET
           public_key_b64=excluded.public_key_b64,
           counter=excluded.counter,
           compromised=false,
           last_used_at=now()`,
        [
          tokenUser.orgId,
          tokenUser.sub,
          deviceId,
          info.credentialID,
          Buffer.from(info.credentialPublicKey).toString('base64'),
          Number(info.counter||0),
          String(info.fmt||''),
          aaguid || null,
          { verified: true, fmt: info.fmt, aaguid },
          response.response && response.response.transports ? response.response.transports : null,
          !!(response.authenticatorAttachment === 'platform')
        ]
      );
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId, action:'webauthn.reg.verify', severity:'info', detail:{ aaguid } });
    });

    return ok(event, { ok:true, aaguid });
  }catch(e){
    return bad(event, 500, 'webauthn-verify-failed');
  }
};
