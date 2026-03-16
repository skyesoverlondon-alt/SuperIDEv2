const { tx, query } = require('./_db');
const { ok, bad, preflight, jwtSign, uuid } = require('./_util');
const { verifyState } = require('./_sso_state');
const { open } = require('./_secrets');
const { buildSP, buildIDP, normalizeAttr, normalizeGroups } = require('./_saml');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');
const { generateAuthenticationOptions, rpId, expectedOrigin, verifyAuthenticationResponse } = require('./_webauthn');

const ROLES = ['viewer','editor','admin','owner'];
function roleRank(r){ return Math.max(0, ROLES.indexOf(String(r||'viewer'))); }

function pickRoleFromGroups(groups, roleMap){
  roleMap = (roleMap && typeof roleMap === 'object') ? roleMap : {};
  let best = 'viewer';
  for(const g of groups){
    const gl = String(g).toLowerCase();
    let r = roleMap[g];
    if(!r){
      for(const k of Object.keys(roleMap)){
        if(String(k).toLowerCase() === gl){ r = roleMap[k]; break; }
      }
    }
    if(r && ROLES.includes(String(r))){
      if(roleRank(r) > roleRank(best)) best = String(r);
    }
  }
  return best;
}

async function applyVaultMap(client, orgId, userId, groups, vaultMap, actorUserId){
  vaultMap = (vaultMap && typeof vaultMap === 'object') ? vaultMap : {};
  const grants = [];
  for(const g of groups){
    const gl = String(g).toLowerCase();
    let v = vaultMap[g];
    if(!v){
      for(const k of Object.keys(vaultMap)){
        if(String(k).toLowerCase() === gl){ v = vaultMap[k]; break; }
      }
    }
    if(!v) continue;
    const list = Array.isArray(v) ? v : [v];
    for(const item of list){
      if(!item || typeof item !== 'object') continue;
      const vaultKey = String(item.vaultKey||'').trim();
      const perm = String(item.perm||'').trim();
      if(!vaultKey) continue;
      if(perm !== 'viewer' && perm !== 'editor') continue;
      grants.push({ vaultKey, perm });
    }
  }
  if(!grants.length) return;

  for(const g of grants){
    await client.query('UPDATE sync_vault_keys SET restricted=true WHERE org_id=$1 AND vault_key=$2', [orgId, g.vaultKey]);
    await client.query(
      `INSERT INTO sync_vault_access(org_id,vault_key,user_id,perm,created_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (org_id,vault_key,user_id) DO UPDATE SET perm=excluded.perm`,
      [orgId, g.vaultKey, userId, g.perm, actorUserId||null]
    );
  }
}

function htmlResp(status, payloadObj){
  // CSP forbids inline scripts; we load /sso/saml-acs.js and provide payload via data attribute.
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>SSO</title>
<link rel="stylesheet" href="/assets/app.css"/>
</head><body class="app">
<div class="wrap" style="max-width:860px;margin:0 auto;padding:24px;">
  <h1 style="margin:0 0 10px;">Signing you in…</h1>
  <p style="opacity:.85;margin:0 0 16px;">Completing secure sign-in.</p>
  <div id="status" style="padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;margin:0 0 12px;">Working…</div>
  <div id="ssoPayload" data-payload="${payloadB64}"></div>
</div>
<script src="/sso/saml-acs.js" defer></script>
</body></html>`;
  return { statusCode: status, headers: { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' }, body: html };
}

function parseFormBody(event){
  const ct = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
  if(String(ct).includes('application/json')){
    try{ return event.body ? JSON.parse(event.body) : {}; }catch(_){ return null; }
  }
  // form
  const raw = event.isBase64Encoded ? Buffer.from(event.body||'', 'base64').toString('utf8') : String(event.body||'');
  const out = {};
  for(const part of raw.split('&')){
    if(!part) continue;
    const idx = part.indexOf('=');
    const k = idx>=0 ? part.slice(0,idx) : part;
    const v = idx>=0 ? part.slice(idx+1) : '';
    out[decodeURIComponent(k.replace(/\+/g,' '))] = decodeURIComponent(v.replace(/\+/g,' '));
  }
  return out;
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const form = parseFormBody(event);
  if(!form) return htmlResp(400, { mode:'error', error:'bad-body' });

  const samlResponse = String(form.SAMLResponse||form.samlResponse||'').trim();
  const relayStateTok = String(form.RelayState||form.relayState||'').trim();
  if(!samlResponse || !relayStateTok) return htmlResp(400, { mode:'error', error:'missing-saml' });

  const st = verifyState(relayStateTok);
  if(!st || st.typ !== 'saml-state-v1' || !st.orgId) return htmlResp(400, { mode:'error', error:'bad-state' });

  try{
    const orgRow = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1', [st.orgId]);
    if(orgRow.rowCount !== 1) return htmlResp(404, { mode:'error', error:'org-not-found' });

    const policy = normalizePolicy(orgRow.rows[0].policy || {});
    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return htmlResp(403, { mode:'error', error:'ip-not-allowed' });
    }

    const deviceId = st.did ? String(st.did) : '';
    if(policy.requireDeviceId && !deviceId) return htmlResp(400, { mode:'error', error:'deviceId-required' });

    const cfg = await query('SELECT idp_sso_url, idp_cert_pem, sp_entity_id, sp_acs_url, sp_cert_pem, sp_key_enc, want_assertions_signed, want_response_signed, nameid_format, attr_email, attr_name, attr_groups, role_map, vault_map FROM sync_sso_saml WHERE org_id=$1', [st.orgId]);
    if(cfg.rowCount !== 1) return htmlResp(409, { mode:'error', error:'saml-not-configured' });
    const row = cfg.rows[0];

    const privKey = row.sp_key_enc ? open(row.sp_key_enc, st.orgId) : null;
    const sp = buildSP({
      spEntityId: row.sp_entity_id,
      acsUrl: row.sp_acs_url,
      wantAssertionsSigned: row.want_assertions_signed !== false,
      wantResponseSigned: row.want_response_signed !== false,
      nameIdFormat: row.nameid_format || null,
      signingCertPem: row.sp_cert_pem || null,
      privateKeyPem: privKey || null
    });
    const idp = buildIDP({ idpSsoUrl: row.idp_sso_url, idpCertPem: row.idp_cert_pem });

    const parsed = await sp.parseLoginResponse(idp, 'post', {
      body: {
        SAMLResponse: samlResponse,
        RelayState: relayStateTok
      }
    });

    const extract = parsed && (parsed.extract || parsed);
    const attrs = (extract && extract.attributes) ? extract.attributes : {};
    const nameID = extract && (extract.nameID || extract.nameid || extract.nameId) ? String(extract.nameID || extract.nameid || extract.nameId) : '';

    const emailKey = String(row.attr_email||'email');
    const nameKey = String(row.attr_name||'displayName');
    const groupsKey = String(row.attr_groups||'groups');

    const email = normalizeAttr(attrs[emailKey] || attrs[emailKey.toLowerCase()] || attrs.email || attrs.mail).trim();
    const name = normalizeAttr(attrs[nameKey] || attrs[nameKey.toLowerCase()] || attrs.displayName || attrs.cn || attrs.name).trim();
    const groups = normalizeGroups(attrs[groupsKey] || attrs[groupsKey.toLowerCase()] || attrs.groups);

    if(!email) return htmlResp(403, { mode:'error', error:'missing-email-attr' });

    const externalId = `saml:${String(row.sp_entity_id)}:${nameID || email}`;
    const roleFromGroups = pickRoleFromGroups(groups, row.role_map || {});

    const out = await tx(async (client)=>{
      // Find existing
      let user = await client.query('SELECT id, role, status FROM sync_users WHERE org_id=$1 AND external_id=$2', [st.orgId, externalId]);
      if(user.rowCount !== 1){
        user = await client.query('SELECT id, role, status FROM sync_users WHERE org_id=$1 AND lower(email)=lower($2)', [st.orgId, email]);
      }

      let userId = null;
      let role = roleFromGroups || 'viewer';

      if(user.rowCount === 1){
        userId = user.rows[0].id;
        if(user.rows[0].status !== 'active') return { err:{ status:403, msg:'user-disabled' } };
        const curRole = String(user.rows[0].role||'viewer');
        if(roleRank(role) < roleRank(curRole)) role = curRole;
        await client.query('UPDATE sync_users SET email=$1, name=COALESCE($2,name), external_id=$3, sso_provider=$4, last_login_at=now() WHERE id=$5', [email, name||null, externalId, 'saml', userId]);
      } else {
        const dummy = { kty:'EC', crv:'P-256', x:'0', y:'0' };
        userId = uuid();
        await client.query(
          'INSERT INTO sync_users(id,org_id,name,role,pubkey_jwk,enc_pubkey_jwk,status,email,external_id,sso_provider,last_login_at) VALUES($1,$2,$3,$4,$5,$6,\'active\',$7,$8,$9,now())',
          [userId, st.orgId, name||null, role, dummy, dummy, email, externalId, 'saml']
        );
      }

      await applyVaultMap(client, st.orgId, userId, groups, row.vault_map || {}, userId);
      await auditTx(client, event, { orgId: st.orgId, userId, deviceId: deviceId||null, action:'sso.saml.login', severity:'info', detail:{ email, groups: groups.slice(0,20) } });
      return { userId, role };
    });

    if(out.err) return htmlResp(out.err.status, { mode:'error', error: out.err.msg });

    // WebAuthn step-up enforcement for SSO (optional)
    const w = (policy.webauthn && typeof policy.webauthn === 'object') ? policy.webauthn : {};
    const requireForLogin = !!w.requireForLogin;
    const enforceEnrollment = !!w.enforceEnrollment;

    let enrolled = false;
    let creds = null;
    if(requireForLogin || enforceEnrollment){
      creds = await query('SELECT credential_id_b64url, public_key_b64, counter, compromised FROM sync_webauthn_creds WHERE org_id=$1 AND user_id=$2 AND compromised=false', [st.orgId, out.userId]);
      enrolled = creds.rowCount > 0;
      if(enforceEnrollment && !enrolled) return htmlResp(403, { mode:'error', error:'webauthn-not-enrolled' });

      if(requireForLogin && enrolled){
        const opts = await generateAuthenticationOptions({
          rpID: rpId(event),
          userVerification: (w.userVerification || 'preferred'),
          allowCredentials: creds.rows.map(c=>({ id: String(c.credential_id_b64url), type:'public-key' }))
        });
        const waChId = uuid();
        const exp = new Date(Date.now() + 5*60*1000);
        await query('INSERT INTO sync_webauthn_challenges(id,org_id,user_id,type,challenge_b64url,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [waChId, st.orgId, out.userId, 'auth', opts.challenge, exp.toISOString()]);

        // pre-auth token (short-lived)
        const now = Math.floor(Date.now()/1000);
        const pre = jwtSign({ typ:'sso-preauth-v1', sso:'saml', sub: out.userId, orgId: st.orgId, role: out.role, did: deviceId||undefined, iat: now, exp: now + 300 });

        return htmlResp(200, {
          mode:'webauthn',
          finalizeEndpoint: '/.netlify/functions/sso-saml-finalize',
          preAuthToken: pre,
          webauthn: { challengeId: waChId, publicKey: opts },
          info: {
            orgId: st.orgId,
            userId: out.userId,
            role: out.role,
            keyModel: String(orgRow.rows[0].key_model||'wrapped-epoch-vault-v1'),
            orgSaltB64: orgRow.rows[0].org_salt_b64,
            orgKdfIterations: orgRow.rows[0].org_kdf_iterations,
            orgEpoch: Number(orgRow.rows[0].key_epoch||1),
            tokenVersion: Number(orgRow.rows[0].token_version||1),
            policy
          }
        });
      }
    }

    // Final JWT
    const orgEpoch = Number(orgRow.rows[0].key_epoch||1);
    const tokenVersion = Number(orgRow.rows[0].token_version||1);
    const keyModel = String(orgRow.rows[0].key_model||'wrapped-epoch-vault-v1');

    const now = Math.floor(Date.now()/1000);
    const ttl = Number(policy.sessionTtlSec || (24*3600));
    const exp = now + Math.min(ttl, (7*24*3600));
    const token = jwtSign({ sub: out.userId, orgId: st.orgId, role: out.role, did: deviceId || undefined, tv: tokenVersion, epoch: orgEpoch, iat: now, exp });

    return htmlResp(200, {
      mode:'final',
      result:{
        token,
        orgId: st.orgId,
        userId: out.userId,
        role: out.role,
        keyModel,
        orgSaltB64: orgRow.rows[0].org_salt_b64,
        orgKdfIterations: orgRow.rows[0].org_kdf_iterations,
        orgEpoch,
        tokenVersion,
        policy,
        webauthn: { enrolled }
      }
    });
  }catch(e){
    return htmlResp(500, { mode:'error', error:'saml-acs-failed' });
  }
};
