const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'GET') return bad(event, 405, 'method-not-allowed');

  const user = authUser(event);
  if(!user) return bad(event, 401, 'unauthorized');
  if(!requireRole(user, 'admin')) return bad(event, 403, 'forbidden');

  try{
    const r = await query(
      'SELECT idp_sso_url, idp_cert_pem, sp_entity_id, sp_acs_url, sp_cert_pem, want_assertions_signed, want_response_signed, nameid_format, attr_email, attr_name, attr_groups, clock_skew_sec, role_map, vault_map, updated_at FROM sync_sso_saml WHERE org_id=$1',
      [user.orgId]
    );
    if(r.rowCount !== 1) return ok(event, { configured:false });
    const row = r.rows[0];
    return ok(event, {
      configured: true,
      idpSsoUrl: row.idp_sso_url,
      idpCertPem: row.idp_cert_pem ? '***set***' : '',
      spEntityId: row.sp_entity_id,
      spAcsUrl: row.sp_acs_url,
      spCertPem: row.sp_cert_pem ? '***set***' : '',
      wantAssertionsSigned: !!row.want_assertions_signed,
      wantResponseSigned: !!row.want_response_signed,
      nameIdFormat: row.nameid_format || '',
      attrEmail: row.attr_email,
      attrName: row.attr_name,
      attrGroups: row.attr_groups,
      clockSkewSec: Number(row.clock_skew_sec||180),
      roleMap: row.role_map || {},
      vaultMap: row.vault_map || {},
      updatedAt: row.updated_at
    });
  }catch(_){
    return bad(event, 500, 'db-error');
  }
};
