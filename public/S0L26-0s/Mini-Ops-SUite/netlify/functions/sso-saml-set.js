const { tx } = require('./_db');
const { json, ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { seal } = require('./_secrets');
const { auditTx } = require('./_audit');

function cleanPem(p){ return String(p||'').trim(); }

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'POST') return bad(event, 405, 'method-not-allowed');

  const user = authUser(event);
  if(!user) return bad(event, 401, 'unauthorized');
  if(!requireRole(user, 'owner')) return bad(event, 403, 'forbidden');

  const body = json(event);
  if(!body) return bad(event, 400, 'bad-json');

  const idpSsoUrl = String(body.idpSsoUrl||'').trim();
  const idpCertPem = cleanPem(body.idpCertPem||'');
  const spEntityId = String(body.spEntityId||'').trim();
  const spAcsUrl = String(body.spAcsUrl||'').trim();
  const spCertPem = cleanPem(body.spCertPem||'');
  const spKeyPem = cleanPem(body.spKeyPem||'');

  if(!idpSsoUrl || !idpCertPem || !spEntityId || !spAcsUrl) return bad(event, 400, 'missing-fields');

  const wantAssertionsSigned = body.wantAssertionsSigned !== false;
  const wantResponseSigned = body.wantResponseSigned !== false;
  const nameIdFormat = body.nameIdFormat ? String(body.nameIdFormat).trim() : null;

  const attrEmail = String(body.attrEmail||'email').trim() || 'email';
  const attrName = String(body.attrName||'displayName').trim() || 'displayName';
  const attrGroups = String(body.attrGroups||'groups').trim() || 'groups';
  const clockSkewSec = Number(body.clockSkewSec||180);

  const roleMap = (body.roleMap && typeof body.roleMap === 'object') ? body.roleMap : {};
  const vaultMap = (body.vaultMap && typeof body.vaultMap === 'object') ? body.vaultMap : {};

  let spKeyEnc = null;
  if(spKeyPem){
    spKeyEnc = seal(spKeyPem, user.orgId);
  }

  try{
    await tx(async (client)=>{
      await client.query(
        `INSERT INTO sync_sso_saml(org_id,idp_sso_url,idp_cert_pem,sp_entity_id,sp_acs_url,sp_cert_pem,sp_key_enc,want_assertions_signed,want_response_signed,nameid_format,attr_email,attr_name,attr_groups,clock_skew_sec,role_map,vault_map,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
         ON CONFLICT (org_id) DO UPDATE SET
           idp_sso_url=excluded.idp_sso_url,
           idp_cert_pem=excluded.idp_cert_pem,
           sp_entity_id=excluded.sp_entity_id,
           sp_acs_url=excluded.sp_acs_url,
           sp_cert_pem=excluded.sp_cert_pem,
           sp_key_enc=COALESCE(excluded.sp_key_enc, sync_sso_saml.sp_key_enc),
           want_assertions_signed=excluded.want_assertions_signed,
           want_response_signed=excluded.want_response_signed,
           nameid_format=excluded.nameid_format,
           attr_email=excluded.attr_email,
           attr_name=excluded.attr_name,
           attr_groups=excluded.attr_groups,
           clock_skew_sec=excluded.clock_skew_sec,
           role_map=excluded.role_map,
           vault_map=excluded.vault_map,
           updated_at=now()`,
        [
          user.orgId, idpSsoUrl, idpCertPem, spEntityId, spAcsUrl,
          spCertPem || null, spKeyEnc,
          !!wantAssertionsSigned, !!wantResponseSigned,
          nameIdFormat,
          attrEmail, attrName, attrGroups,
          Number.isFinite(clockSkewSec) ? Math.max(0, Math.min(3600, clockSkewSec)) : 180,
          roleMap, vaultMap
        ]
      );
      await auditTx(client, event, { orgId: user.orgId, userId: user.sub, deviceId: user.did||null, action:'sso.saml.set', severity:'info', detail:{} });
    });
    return ok(event, { ok:true });
  }catch(e){
    return bad(event, 500, 'db-error');
  }
};
