import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';

function sha256(buf){
  return crypto.createHash('sha256').update(buf).digest();
}

function b64(buf){
  return Buffer.from(buf).toString('base64');
}

const manifestPath = process.argv[2] || 'public/updates/latest.json';
const outSigPath = process.argv[3] || 'public/updates/latest.sig';

const keyId = process.env.UPDATE_KMS_KEY_ID;
if(!keyId) throw new Error('Missing UPDATE_KMS_KEY_ID');
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
if(!region) throw new Error('Missing AWS_REGION');
const alg = process.env.UPDATE_KMS_ALG || 'RSASSA_PKCS1_V1_5_SHA_256';

const raw = readFileSync(manifestPath);
const digest = sha256(raw);

const client = new KMSClient({ region });
const res = await client.send(new SignCommand({
  KeyId: keyId,
  Message: digest,
  MessageType: 'DIGEST',
  SigningAlgorithm: alg
}));

if(!res.Signature) throw new Error('KMS returned no signature');

const sigB64 = b64(res.Signature);
writeFileSync(outSigPath, sigB64 + '\n', 'utf8');
console.log(`Wrote ${outSigPath} (alg=${alg}, key=${keyId})`);
