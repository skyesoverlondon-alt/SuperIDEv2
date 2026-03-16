const crypto = require('crypto');

function base64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64urlToBuf(s){
  s = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
  while(s.length % 4) s += '=';
  return Buffer.from(s,'base64');
}
function hmac(secret, data){
  return crypto.createHmac('sha256', secret).update(data).digest();
}
function getSecret(){
  return process.env.SSO_STATE_SECRET || process.env.SYNC_JWT_SECRET || '';
}

function signState(payload){
  const secret = getSecret();
  if(!secret) throw new Error('missing SSO_STATE_SECRET (or SYNC_JWT_SECRET)');
  const header = { alg:'HS256', typ:'JWT' };
  const enc = (o)=>base64url(Buffer.from(JSON.stringify(o)));
  const p = enc(header)+'.'+enc(payload);
  const sig = base64url(hmac(secret, p));
  return p+'.'+sig;
}

function verifyState(token){
  const secret = getSecret();
  if(!secret) throw new Error('missing SSO_STATE_SECRET (or SYNC_JWT_SECRET)');
  const parts = String(token||'').split('.');
  if(parts.length !== 3) return null;
  const [h,p,s] = parts;
  let sigBuf;
  try{ sigBuf = base64urlToBuf(s); }catch(_){ return null; }
  const expBuf = hmac(secret, h+'.'+p);
  if(!sigBuf || sigBuf.length !== expBuf.length) return null;
  try{ if(!crypto.timingSafeEqual(sigBuf, expBuf)) return null; }catch(_){ return null; }
  let payload;
  try{ payload = JSON.parse(base64urlToBuf(p).toString('utf8')); }catch(_){ return null; }
  const now = Math.floor(Date.now()/1000);
  if(payload.exp && payload.exp < now) return null;
  return payload;
}

module.exports = { signState, verifyState, base64url };
