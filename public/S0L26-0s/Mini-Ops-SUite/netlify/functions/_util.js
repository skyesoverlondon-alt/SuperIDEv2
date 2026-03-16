const crypto = require('crypto');

const ROLES = ['viewer','editor','admin','owner'];

function json(event){
  try{ return event.body ? JSON.parse(event.body) : {}; }catch(_){ return null; }
}

function base64url(buf){
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g,'-')
    .replace(/\//g,'_')
    .replace(/=+$/,'');
}

function base64urlToBuf(s){
  s = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
  while(s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function b64ToBuf(b64){
  return Buffer.from(String(b64||''), 'base64');
}

function pickOrigin(event){
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '*';
  const allow = process.env.SYNC_ALLOWED_ORIGINS;
  if(!allow) return origin === 'null' ? '*' : origin;
  const list = allow.split(',').map(s=>s.trim()).filter(Boolean);
  if(list.includes('*')) return origin === 'null' ? '*' : origin;
  return list.includes(origin) ? origin : (list[0] || '*');
}

function resp(event, status, obj){
  const origin = pickOrigin(event);
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Skye-Device-Id, X-Device-Id, X-Skye-Bind-TS, X-Skye-Bind-Nonce, X-Skye-Body-Hash, X-Skye-Bind',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj)
  };
}

function ok(event, obj){ return resp(event, 200, obj); }
function bad(event, status, msg, extra){ return resp(event, status, Object.assign({ error: msg }, extra||{})); }

function preflight(event){
  const origin = pickOrigin(event);
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Skye-Device-Id, X-Device-Id, X-Skye-Bind-TS, X-Skye-Bind-Nonce, X-Skye-Body-Hash, X-Skye-Bind',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store'
    },
    body: ''
  };
}

function hmac(secret, data){
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function jwtSign(payload){
  const secret = process.env.SYNC_JWT_SECRET;
  if(!secret) throw new Error('missing SYNC_JWT_SECRET');

  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = (o) => base64url(Buffer.from(JSON.stringify(o)));
  const p = enc(header) + '.' + enc(payload);
  const sig = base64url(hmac(secret, p));
  return p + '.' + sig;
}

function jwtVerify(token){
  const secret = process.env.SYNC_JWT_SECRET;
  if(!secret) throw new Error('missing SYNC_JWT_SECRET');

  const parts = String(token||'').split('.');
  if(parts.length !== 3) return null;
  const [h,p,s] = parts;
  // Timing-safe signature verification
  let sigBuf = null;
  try{ sigBuf = base64urlToBuf(s); }catch(_){ return null; }
  const expBuf = hmac(secret, h + '.' + p);
  if(!sigBuf || sigBuf.length !== expBuf.length) return null;
  try{
    if(!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  }catch(_){
    return null;
  }

  let payload = null;
  try{ payload = JSON.parse(base64urlToBuf(p).toString('utf8')); }catch(_){ return null; }

  const now = Math.floor(Date.now()/1000);
  if(payload.exp && payload.exp < now) return null;
  return payload;
}

function authUser(event){
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if(!m) return null;
  return jwtVerify(m[1]);
}

function requireRole(user, minRole){
  if(!user || !user.role) return false;
  const u = ROLES.indexOf(user.role);
  const r = ROLES.indexOf(minRole);
  return u >= r;
}

function uuid(){
  return crypto.randomUUID();
}

function randCode(bytes=18){
  return base64url(crypto.randomBytes(bytes));
}

function inviteHash(code){
  const sec = process.env.SYNC_INVITE_SECRET;
  if(!sec) throw new Error('missing SYNC_INVITE_SECRET');
  return base64url(hmac(sec, String(code||'')));
}

async function verifyEcdsa(pubJwk, nonceB64Url, signatureB64){
  const subtle = crypto.webcrypto.subtle;
  const pubKey = await subtle.importKey(
    'jwk',
    pubJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const nonce = base64urlToBuf(nonceB64Url);
  const sig = b64ToBuf(signatureB64);
  return subtle.verify({name:'ECDSA', hash:'SHA-256'}, pubKey, sig, nonce);
}

module.exports = {
  json, ok, bad, preflight,
  jwtSign, jwtVerify, authUser, requireRole,
  uuid, randCode, inviteHash,
  verifyEcdsa
};
