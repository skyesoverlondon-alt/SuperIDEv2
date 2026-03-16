const { query } = require('./_db');
const { ok, bad, preflight, requireRole } = require('./_util');
const { requireCtx } = require('./_authz');
const { open } = require('./_secrets');
const { buildSP } = require('./_saml');

function xmlResp(event, status, xml){
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/samlmetadata+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    },
    body: xml
  };
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return preflight(event);
  if(event.httpMethod !== 'GET') return bad(event, 405, 'method-not-allowed');

  // Allow public metadata if orgId is provided.
  const q = event.queryStringParameters || {};
  let orgId = String(q.orgId||'').trim();

  if(!orgId){
    const u = authUser(event);
    if(!u) return bad(event, 400, 'orgId-required');
    if(!requireRole(u, 'admin')) return bad(event, 403, 'forbidden');
    orgId = u.orgId;
  }

  try{
    const r = await query('SELECT idp_sso_url, idp_cert_pem, sp_entity_id, sp_acs_url, sp_cert_pem, sp_key_enc, want_assertions_signed, want_response_signed, nameid_format FROM sync_sso_saml WHERE org_id=$1', [orgId]);
    if(r.rowCount !== 1) return bad(event, 404, 'saml-not-configured');
    const row = r.rows[0];

    const privateKeyPem = row.sp_key_enc ? open(row.sp_key_enc, orgId) : null;
    const sp = buildSP({
      spEntityId: row.sp_entity_id,
      acsUrl: row.sp_acs_url,
      wantAssertionsSigned: row.want_assertions_signed !== false,
      wantResponseSigned: row.want_response_signed !== false,
      nameIdFormat: row.nameid_format || null,
      signingCertPem: row.sp_cert_pem || null,
      privateKeyPem: privateKeyPem || null
    });

    const xml = sp.getMetadata();
    return xmlResp(event, 200, xml);
  }catch(e){
    return xmlResp(event, 500, '<error>metadata-failed</error>');
  }
};
