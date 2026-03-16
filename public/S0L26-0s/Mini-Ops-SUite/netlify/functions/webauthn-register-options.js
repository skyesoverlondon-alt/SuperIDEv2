const { tx, query } = require('./_db');
const { ok, bad, preflight, uuid } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');
const { generateRegistrationOptions, rpId, rpName } = require('./_webauthn');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  try{
    const org = await query('SELECT policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
    if(org.rowCount !== 1) return bad(event, 401, 'unauthorized');
    const policy = normalizePolicy(org.rows[0].policy || {});

    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }

    const me = await query('SELECT status, name, email FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
    if(me.rowCount !== 1) return bad(event, 401, 'unauthorized');
    if(me.rows[0].status !== 'active') return bad(event, 403, 'user-disabled');

    const creds = await query('SELECT credential_id_b64url FROM sync_webauthn_creds WHERE org_id=$1 AND user_id=$2 AND compromised=false', [tokenUser.orgId, tokenUser.sub]);

    const w = (policy.webauthn && typeof policy.webauthn === 'object') ? policy.webauthn : {};
    const uv = (w.userVerification || 'preferred');
    const att = (w.attestation || 'none');

    const opts = await generateRegistrationOptions({
      rpName: rpName(),
      rpID: rpId(event),
      userID: String(tokenUser.sub),
      userName: String(me.rows[0].email || me.rows[0].name || tokenUser.sub),
      attestationType: att,
      authenticatorSelection: {
        userVerification: uv
      },
      excludeCredentials: creds.rows.map(c=>({ id: String(c.credential_id_b64url), type:'public-key' }))
    });

    const challengeId = uuid();
    const exp = new Date(Date.now() + 5*60*1000);

    await tx(async (client)=>{
      await client.query('INSERT INTO sync_webauthn_challenges(id,org_id,user_id,type,challenge_b64url,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [challengeId, tokenUser.orgId, tokenUser.sub, 'reg', opts.challenge, exp.toISOString()]);
      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'webauthn.reg.options', severity:'info', detail:{} });
    });

    return ok(event, { challengeId, publicKey: opts });
  }catch(_){
    return bad(event, 500, 'webauthn-options-failed');
  }
};
