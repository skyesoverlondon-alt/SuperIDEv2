const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

function pickHost(event){
  const h = event.headers || {};
  return String(h['x-forwarded-host'] || h['host'] || h['Host'] || '').split(',')[0].trim();
}

function rpId(event){
  return process.env.WEBAUTHN_RP_ID || pickHost(event);
}

function rpName(){
  return process.env.WEBAUTHN_RP_NAME || 'SkyeSync';
}

function expectedOrigin(event){
  if(process.env.WEBAUTHN_EXPECTED_ORIGIN) return process.env.WEBAUTHN_EXPECTED_ORIGIN;
  const h = event.headers || {};
  const o = String(h.origin || h.Origin || '').trim();
  if(o) return o;
  const host = pickHost(event);
  return host ? `https://${host}` : '';
}

function b64ToBuf(b64){
  return Buffer.from(String(b64||''), 'base64');
}

module.exports = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  rpId,
  rpName,
  expectedOrigin,
  b64ToBuf
};
