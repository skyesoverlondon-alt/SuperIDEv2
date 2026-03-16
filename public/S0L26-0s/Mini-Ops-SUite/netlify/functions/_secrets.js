const crypto = require('crypto');

function getKey(){
  const raw = process.env.SYNC_SECRETS_KEY || '';
  if(!raw) throw new Error('missing SYNC_SECRETS_KEY');
  let buf;
  if(/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    // base64
    buf = Buffer.from(raw, 'base64');
  }
  if(buf.length !== 32) throw new Error('SYNC_SECRETS_KEY must be 32 bytes (base64 or hex)');
  return buf;
}

function b64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function b64urlToBuf(s){
  s = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
  while(s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function seal(plaintext, aad){
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if(aad) cipher.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([cipher.update(String(plaintext||''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(ct)}.${b64url(tag)}`;
}

function open(sealed, aad){
  const s = String(sealed||'');
  const m = s.match(/^v1\.([^.]+)\.([^.]+)\.([^.]+)$/);
  if(!m) throw new Error('bad-sealed-secret');
  const [,ivB64,ctB64,tagB64] = m;
  const key = getKey();
  const iv = b64urlToBuf(ivB64);
  const ct = b64urlToBuf(ctB64);
  const tag = b64urlToBuf(tagB64);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if(aad) decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { seal, open };
