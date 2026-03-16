import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { KMSClient, GetPublicKeyCommand } from '@aws-sdk/client-kms';

const keyId = process.env.UPDATE_KMS_KEY_ID;
if(!keyId) throw new Error('Missing UPDATE_KMS_KEY_ID');
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
if(!region) throw new Error('Missing AWS_REGION');

const outPath = process.argv[2] || 'public/updates/public.jwk';

const client = new KMSClient({ region });
const res = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
if(!res.PublicKey) throw new Error('No PublicKey returned');

const keyObj = crypto.createPublicKey({ key: Buffer.from(res.PublicKey), format: 'der', type: 'spki' });
const jwk = keyObj.export({ format: 'jwk' });
writeFileSync(outPath, JSON.stringify(jwk, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath}`);
