const { tx } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { getClientIp, ipInAllowlist, normalizePolicy } = require('./_security');
const { seal } = require('./_secrets');
const { auditTx } = require('./_audit');

function cleanUrl(s){
  s = String(s||'').trim();
  if(!s) return '';
  return s.replace(/\s+/g,'');
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const auth = await requireCtx(event, { minRole: 'viewer' });
  if(auth.resp) return auth.resp;
  const tokenUser = auth.ctx.token;
  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const issuer = cleanUrl(body.issuer).replace(/\/$/,'');
  const clientId = String(body.clientId||'').trim();
  const clientSecret = (body.clientSecret === null || body.clientSecret === undefined) ? null : String(body.clientSecret);
  const redirectUri = cleanUrl(body.redirectUri);
  const scope = String(body.scope||'openid email profile').trim().slice(0,200);
  const claimEmail = String(body.claimEmail||'email').trim().slice(0,64);
  const claimName = String(body.claimName||'name').trim().slice(0,64);
  const claimGroups = String(body.claimGroups||'groups').trim().slice(0,64);
  const requireVerifiedEmail = !!body.requireVerifiedEmail;
  const roleMap = (body.roleMap && typeof body.roleMap === 'object') ? body.roleMap : {};
  const vaultMap = (body.vaultMap && typeof body.vaultMap === 'object') ? body.vaultMap : {};

  if(!issuer || !issuer.startsWith('https://')) return bad(event, 400, 'issuer-required');
  if(!clientId) return bad(event, 400, 'clientId-required');
  if(!redirectUri || !redirectUri.startsWith('https://')) return bad(event, 400, 'redirectUri-required');

  try{
    const out = await tx(async (client)=>{
      const me = await client.query('SELECT role, status FROM sync_users WHERE id=$1 AND org_id=$2', [tokenUser.sub, tokenUser.orgId]);
      if(me.rowCount !== 1) return { err:{ status:401, msg:'unauthorized' } };
      if(me.rows[0].status !== 'active') return { err:{ status:403, msg:'user-disabled' } };
      if(!requireRole({role: me.rows[0].role}, 'owner')) return { err:{ status:403, msg:'forbidden' } };

      const org = await client.query('SELECT policy FROM sync_orgs WHERE id=$1', [tokenUser.orgId]);
      if(org.rowCount === 1){
        const pol = normalizePolicy(org.rows[0].policy || {});
        const ip = getClientIp(event);
        if((pol.requireIpAllowlist || (pol.ipAllowlist && pol.ipAllowlist.length)) && !ipInAllowlist(ip, pol.ipAllowlist)){
          return { err:{ status:403, msg:'ip-not-allowed' } };
        }
      }

      let secretEnc = null;
      if(clientSecret !== null){
        // Store encrypted; tie AAD to orgId to prevent cross-org swapping.
        secretEnc = clientSecret ? seal(clientSecret, tokenUser.orgId) : null;
      }

      // Upsert. If clientSecret is null (omitted), keep existing.
      const existing = await client.query('SELECT client_secret_enc FROM sync_sso_oidc WHERE org_id=$1', [tokenUser.orgId]);
      const prev = existing.rowCount===1 ? existing.rows[0].client_secret_enc : null;
      const nextSecret = (clientSecret === null) ? prev : secretEnc;

      await client.query(
        `INSERT INTO sync_sso_oidc(org_id,issuer,client_id,client_secret_enc,redirect_uri,scope,claim_email,claim_name,claim_groups,require_verified_email,role_map,vault_map,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
         ON CONFLICT (org_id) DO UPDATE SET
           issuer=excluded.issuer,
           client_id=excluded.client_id,
           client_secret_enc=excluded.client_secret_enc,
           redirect_uri=excluded.redirect_uri,
           scope=excluded.scope,
           claim_email=excluded.claim_email,
           claim_name=excluded.claim_name,
           claim_groups=excluded.claim_groups,
           require_verified_email=excluded.require_verified_email,
           role_map=excluded.role_map,
           vault_map=excluded.vault_map,
           updated_at=now()`,
        [tokenUser.orgId, issuer, clientId, nextSecret, redirectUri, scope, claimEmail, claimName, claimGroups, requireVerifiedEmail, roleMap, vaultMap]
      );

      await auditTx(client, event, { orgId: tokenUser.orgId, userId: tokenUser.sub, deviceId: tokenUser.did||null, action:'sso.oidc.set', severity:'info', detail:{ issuer, clientId, redirectUri } });
      return { ok:true };
    });

    if(out.err) return bad(event, out.err.status, out.err.msg);
    return ok(event, out);
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
