import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

const outPub = path.resolve('public/updates/public.jwk');
const outPrivDir = path.resolve('tools/.private');
const outPriv = path.join(outPrivDir, 'update-signing-key.private.jwk');

await fs.promises.mkdir(outPrivDir, { recursive:true });

const kp = await subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
const pubJwk = await subtle.exportKey('jwk', kp.publicKey);
const privJwk = await subtle.exportKey('jwk', kp.privateKey);

// Public key is safe to ship.
pubJwk.key_ops = ['verify'];

await fs.promises.writeFile(outPub, JSON.stringify(pubJwk, null, 2) + '\n', 'utf8');
await fs.promises.writeFile(outPriv, JSON.stringify(privJwk, null, 2) + '\n', 'utf8');

console.log('✅ Generated update signing keys');
console.log('Public:', outPub);
console.log('Private (KEEP SECRET):', outPriv);
console.log('Next: node tools/build-update-manifest.mjs && node tools/sign-update.mjs');
