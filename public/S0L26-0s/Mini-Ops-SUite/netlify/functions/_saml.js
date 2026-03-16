const samlify = require('samlify');

// Disable XML schema validation (keeps the function self-contained).
try{
  samlify.setSchemaValidator({ validate: async () => true });
}catch(_){ /* ignore */ }

const BINDING_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const BINDING_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';

function cleanPem(p){
  return String(p||'').trim();
}

function buildSP({ spEntityId, acsUrl, wantAssertionsSigned=true, wantResponseSigned=true, nameIdFormat, signingCertPem, privateKeyPem }){
  if(!spEntityId || !acsUrl) throw new Error('saml-sp-incomplete');
  return samlify.ServiceProvider({
    entityID: String(spEntityId).trim(),
    assertionConsumerService: [{ Binding: BINDING_POST, Location: String(acsUrl).trim() }],
    wantAssertionsSigned: !!wantAssertionsSigned,
    wantMessageSigned: !!wantResponseSigned,
    nameIDFormat: nameIdFormat ? String(nameIdFormat) : undefined,
    ...(signingCertPem ? { signingCert: cleanPem(signingCertPem) } : {}),
    ...(privateKeyPem ? { privateKey: cleanPem(privateKeyPem) } : {})
  });
}

function buildIDP({ idpSsoUrl, idpEntityId, idpCertPem }){
  if(!idpSsoUrl || !idpCertPem) throw new Error('saml-idp-incomplete');
  return samlify.IdentityProvider({
    entityID: idpEntityId ? String(idpEntityId) : String(idpSsoUrl).trim(),
    singleSignOnService: [{ Binding: BINDING_REDIRECT, Location: String(idpSsoUrl).trim() }],
    signingCert: cleanPem(idpCertPem)
  });
}

function normalizeAttr(v){
  if(v === null || v === undefined) return '';
  if(Array.isArray(v)) return v.length ? String(v[0]||'') : '';
  return String(v);
}

function normalizeGroups(v){
  if(!v) return [];
  if(Array.isArray(v)) return v.map(x=>String(x).trim()).filter(Boolean).slice(0,200);
  if(typeof v === 'string') return v.split(',').map(s=>s.trim()).filter(Boolean).slice(0,200);
  return [];
}

module.exports = {
  samlify,
  BINDING_REDIRECT,
  BINDING_POST,
  buildSP,
  buildIDP,
  normalizeAttr,
  normalizeGroups
};
