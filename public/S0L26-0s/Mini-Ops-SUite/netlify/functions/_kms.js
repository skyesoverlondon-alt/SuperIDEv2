const { KMSClient, SignCommand } = require('@aws-sdk/client-kms');

function b64(buf){
  return Buffer.from(buf).toString('base64');
}

function client(){
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if(!region) throw new Error('missing AWS_REGION');
  return new KMSClient({ region });
}

function defaultAlg(){
  // Works for RSA keys; for ECC keys set AUDIT_KMS_ALG=ECDSA_SHA_256.
  return process.env.AUDIT_KMS_ALG || 'RSASSA_PKCS1_V1_5_SHA_256';
}

async function kmsSignDigest(digestBytes, { keyId, alg } = {}){
  const KeyId = keyId || process.env.AUDIT_KMS_KEY_ID || '';
  if(!KeyId) throw new Error('missing AUDIT_KMS_KEY_ID');
  const SigningAlgorithm = alg || defaultAlg();

  const c = client();
  const cmd = new SignCommand({
    KeyId,
    Message: Buffer.from(digestBytes),
    MessageType: 'DIGEST',
    SigningAlgorithm
  });
  const res = await c.send(cmd);
  if(!res || !res.Signature) throw new Error('kms-sign-failed');
  return {
    signatureB64: b64(res.Signature),
    alg: SigningAlgorithm,
    keyId: KeyId
  };
}

module.exports = { kmsSignDigest };
