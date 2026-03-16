const { tx, query } = require('./_db');
const { json, ok, bad, preflight, jwtSign, uuid } = require('./_util');
const { verifyState } = require('./_sso_state');
const { verifyIdToken } = require('./_oidc');
const { open } = require('./_secrets');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { auditTx } = require('./_audit');

const ROLES = ['viewer','editor','admin','owner'];
function roleRank(r){ return Math.max(0, ROLES.indexOf(String(r||'viewer'))); }

function normalizeGroups(v){
  if(!v) return [];
  if(Array.isArray(v)) return v.map(String).map(s=>s.trim()).filter(Boolean).slice(0,200);
  if(typeof v === 'string'){
    // allow comma-separated
    return v.split(',').map(s=>s.trim()).filter(Boolean).slice(0,200);
  }
  return [];
}

function pickRoleFromGroups(groups, roleMap){
  roleMap = (roleMap && typeof roleMap === 'object') ? roleMap : {};
  let best = 'viewer';
  for(const g of groups){
    const key = g;
    const key2 = String(g).toLowerCase();
    // try exact then case-insensitive
    let r = roleMap[key];
    if(!r){
      for(const k of Object.keys(roleMap)){
        if(String(k).toLowerCase() === key2){ r = roleMap[k]; break; }
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
    let v = vaultMap[g];
    if(!v){
      const gl = String(g).toLowerCase();
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

  // Ensure vault key rows exist + mark restricted if granting.
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

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const code = String(body.code||'').trim();
  const stateToken = String(body.state||'').trim();
  const codeVerifier = String(body.codeVerifier||'').trim();
  const deviceId = String(body.deviceId||'').trim().slice(0,80) || null;
  const displayName = String(body.name||'').trim().slice(0,120) || null;

  if(!code || !stateToken || !codeVerifier) return bad(event, 400, 'missing-fields');

  const st = verifyState(stateToken);
  if(!st || st.typ !== 'oidc-state-v1' || !st.orgId) return bad(event, 400, 'bad-state');
  if(st.did && deviceId && String(st.did) !== String(deviceId)) return bad(event, 409, 'device-mismatch');

  try{
    // Load org policy and OIDC config
    const org = await query('SELECT org_salt_b64, org_kdf_iterations, key_epoch, token_version, key_model, policy FROM sync_orgs WHERE id=$1', [st.orgId]);
    if(org.rowCount !== 1) return bad(event, 404, 'org-not-found');
    const orgEpoch = Number(org.rows[0].key_epoch||1);
    const tokenVersion = Number(org.rows[0].token_version||1);
    const keyModel = String(org.rows[0].key_model||'wrapped-epoch-vault-v1');
    const policy = normalizePolicy(org.rows[0].policy || {});

    const ip = getClientIp(event);
    if((policy.requireIpAllowlist || (policy.ipAllowlist && policy.ipAllowlist.length)) && !ipInAllowlist(ip, policy.ipAllowlist)){
      return bad(event, 403, 'ip-not-allowed');
    }
    if(policy.requireDeviceId && !deviceId) return bad(event, 400, 'deviceId-required');

    const cfg = await query('SELECT issuer, client_id, client_secret_enc, redirect_uri, scope, claim_email, claim_name, claim_groups, require_verified_email, role_map, vault_map FROM sync_sso_oidc WHERE org_id=$1', [st.orgId]);
    if(cfg.rowCount !== 1) return bad(event, 409, 'oidc-not-configured');
    const row = cfg.rows[0];

    const issuer = String(row.issuer||'').replace(/\/$/,'');
    const clientId = String(row.client_id||'');
    const redirectUri = String(row.redirect_uri||'');
    const clientSecret = row.client_secret_enc ? open(row.client_secret_enc, st.orgId) : '';

    // Exchange code for tokens
    const disc = await (require('./_oidc').discover)(issuer);
    const tokenRes = await fetch(disc.token_endpoint, {
      method:'POST',
      headers:{
        'Content-Type':'application/x-www-form-urlencoded',
        'Accept':'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        code_verifier: codeVerifier
      }).toString()
    });

    const tokenTxt = await tokenRes.text();
    let tokenJson = null;
    try{ tokenJson = tokenTxt ? JSON.parse(tokenTxt) : null; }catch(_){ tokenJson = null; }
    if(!tokenRes.ok) return bad(event, 401, 'oidc-token-exchange-failed', { detail: tokenJson || tokenTxt });

    const idToken = tokenJson && tokenJson.id_token;
    if(!idToken) return bad(event, 401, 'oidc-missing-id-token');

    const { payload } = await verifyIdToken(idToken, { issuer, audience: clientId, nonce: st.nonce });

    const claimEmail = String(row.claim_email||'email');
    const claimName = String(row.claim_name||'name');
    const claimGroups = String(row.claim_groups||'groups');

    const email = payload[claimEmail] ? String(payload[claimEmail]).trim() : '';
    const name = payload[claimName] ? String(payload[claimName]).trim() : (displayName || '');
    const groups = normalizeGroups(payload[claimGroups]);

    if(!email) return bad(event, 401, 'oidc-missing-email');
    if(row.require_verified_email){
      const ev = payload.email_verified;
      if(ev !== true && ev !== 'true') return bad(event, 403, 'email-not-verified');
    }

    const externalId = `oidc:${issuer}:${String(payload.sub||'')}`;

    const roleFromGroups = pickRoleFromGroups(groups, row.role_map || {});

    const out = await tx(async (client)=>{
      // Create or find user
      let user = await client.query('SELECT id, role, status FROM sync_users WHERE org_id=$1 AND external_id=$2', [st.orgId, externalId]);
      if(user.rowCount !== 1){
        // try by email
        user = await client.query('SELECT id, role, status FROM sync_users WHERE org_id=$1 AND lower(email)=lower($2)', [st.orgId, email]);
      }

      let userId = null;
      let role = roleFromGroups || 'viewer';

      if(user.rowCount === 1){
        userId = user.rows[0].id;
        if(user.rows[0].status !== 'active') return { err:{ status:403, msg:'user-disabled' } };
        // don't downgrade role automatically; only upgrade unless explicitly allowed.
        const curRole = String(user.rows[0].role||'viewer');
        if(roleRank(role) < roleRank(curRole)) role = curRole;

        await client.query('UPDATE sync_users SET email=$1, name=COALESCE($2,name), external_id=$3, sso_provider=$4, last_login_at=now() WHERE id=$5', [email, name||null, externalId, 'oidc', userId]);
      } else {
        // Create fresh user with random auth/encryption keys placeholders; client will upload real keys next.
        // We set temporary dummy JWKs that will be replaced immediately by client.
        const dummy = { kty:'EC', crv:'P-256', x:'0', y:'0' };
        userId = uuid();
        await client.query(
          'INSERT INTO sync_users(id,org_id,name,role,pubkey_jwk,enc_pubkey_jwk,status,email,external_id,sso_provider,last_login_at) VALUES($1,$2,$3,$4,$5,$6,\'active\',$7,$8,$9,now())',
          [userId, st.orgId, name||null, role, dummy, dummy, email, externalId, 'oidc']
        );
      }

      // Apply vault grants from groups (optional)
      await applyVaultMap(client, st.orgId, userId, groups, row.vault_map || {}, userId);

      await auditTx(client, event, { orgId: st.orgId, userId, deviceId, action:'sso.oidc.login', severity:'info', detail:{ email, groups: groups.slice(0,20) } });
      return { userId, role };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);

        const me = await query('SELECT COALESCE(token_version,1) as token_version FROM sync_users WHERE org_id=$1 AND id=$2', [st.orgId, out.userId]);
    const userTokenVersion = (me.rowCount===1) ? Number(me.rows[0].token_version||1) : 1;

    const now = Math.floor(Date.now()/1000);
    const ttl = Number(policy.sessionTtlSec || (24*3600));
    const exp = now + Math.min(ttl, (7*24*3600));
    const token = jwtSign({ sub: out.userId, orgId: st.orgId, role: out.role, did: deviceId || undefined, tv: tokenVersion,
      userTokenVersion, uv: userTokenVersion, epoch: orgEpoch, iat: now, exp });

    return ok(event, {
      token,
      orgId: st.orgId,
      userId: out.userId,
      role: out.role,
      keyModel,
      orgSaltB64: org.rows[0].org_salt_b64,
      orgKdfIterations: org.rows[0].org_kdf_iterations,
      orgEpoch,
      tokenVersion,
      userTokenVersion,
      policy
    });
  }catch(e){
    return bad(event, 500, 'oidc-callback-failed');
  }
};
