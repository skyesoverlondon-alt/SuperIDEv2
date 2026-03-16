import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

function usage(){
  console.log('Usage: node tools/sign-update.mjs [path/to/latest.json] [path/to/latest.sig]');
  console.log('Private key source (choose one):');
  console.log('  - Env var UPDATE_SIGNING_PRIVATE_JWK (full JWK JSON string)');
  console.log('  - File tools/.private/update-signing-key.private.jwk');
}

const jsonPath = process.argv[2] || 'public/updates/latest.json';
const sigOut = process.argv[3] || 'public/updates/latest.sig';

let privJwk = null;
if(process.env.UPDATE_SIGNING_PRIVATE_JWK){
  try{ privJwk = JSON.parse(process.env.UPDATE_SIGNING_PRIVATE_JWK); }catch(_){
    console.error('❌ UPDATE_SIGNING_PRIVATE_JWK is not valid JSON');
    process.exit(1);
  }
} else {
  const p = path.resolve('tools/.private/update-signing-key.private.jwk');
  if(fs.existsSync(p)) privJwk = JSON.parse(fs.readFileSync(p, 'utf8'));
}

if(!privJwk){
  console.error('❌ Missing private signing key. Generate one: node tools/generate-update-keys.mjs');
  usage();
  process.exit(1);
}

const jsonBytes = fs.readFileSync(path.resolve(jsonPath));

const key = await subtle.importKey('jwk', privJwk, {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
const sig = await subtle.sign({name:'ECDSA', hash:'SHA-256'}, key, jsonBytes);
const b64 = Buffer.from(sig).toString('base64');
fs.writeFileSync(path.resolve(sigOut), b64.trim() + '\n', 'utf8');
console.log('✅ Signed', sigOut);
