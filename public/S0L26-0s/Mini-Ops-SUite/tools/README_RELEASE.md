# Release + Signed Updates (Production)

This product supports a signed update channel so devices can verify that update notices (and optionally the deployed assets) were authorized by the publisher.

## Non-negotiable rule

**Never ship or commit the update signing private key.**

If you distribute this repo/ZIP to customers, the private key must live outside the artifact (CI secret, password manager, offline vault).

## One-time: generate keys (publisher only)

```bash
node tools/generate-update-keys.mjs
```

Outputs:
- `public/updates/public.jwk` (safe to deploy)
- `tools/.private/update-signing-key.private.jwk` (**keep secret; do not commit; do not distribute**)

## Every release: build + sign the manifest

1) Update `public/assets/build.json` (new `buildId`, notes, schemaVersion)
2) Generate a manifest with asset hashes:

```bash
node tools/build-update-manifest.mjs
```

3) Sign it:

```bash
node tools/sign-update.mjs
```

This writes:
- `public/updates/latest.json`
- `public/updates/latest.sig`

## CI option (recommended)

Store your private key as a CI secret named:
- `UPDATE_SIGNING_PRIVATE_JWK`

Then run:

```bash
node tools/build-update-manifest.mjs
node tools/sign-update.mjs
```

## Client behavior

- The app verifies `latest.json` against `latest.sig` using `public.jwk`.
- If `manifest.assets[]` is present and `verifyAssets` is enabled (default), the app will also verify the deployed assets match the signed hashes.


## Customer-managed HSM / KMS signing (AWS KMS)

If you want the signing key to live in an HSM-backed service instead of a file, use AWS KMS.

Environment:
- `AWS_REGION`
- `UPDATE_KMS_KEY_ID`
- (optional) `UPDATE_KMS_ALG` (default: `RSASSA_PKCS1_V1_5_SHA_256`)

Export the public JWK for the client verifier:

```bash
node tools/kms-public-jwk.mjs
```

Sign the manifest via KMS:

```bash
node tools/build-update-manifest.mjs
node tools/kms-sign-update.mjs
```
