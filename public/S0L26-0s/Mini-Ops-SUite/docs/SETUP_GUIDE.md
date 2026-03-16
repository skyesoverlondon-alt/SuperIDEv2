# Setup Guide — Skye Mini Ops Suite (Offline‑First + Optional SkyeSync)

This suite is **offline-first**. You can deploy and use it as a zero‑backend PWA, then optionally turn on **SkyeSync** (E2EE sync + RBAC + SSO/SCIM/WebAuthn + WORM audits).

## 1) Offline-only setup

1. Deploy to any static host (Netlify recommended).
2. Open the site once while online (primes the PWA cache).
3. Install it (Chrome/Edge menu → “Install app”).
4. Use **Export suite** regularly.

No accounts, no database, no functions required.

## 2) Enable SkyeSync (E2EE sync + RBAC)

SkyeSync runs on Netlify Functions and Postgres (Neon works well). The server stores **ciphertext only**.

### Prerequisites
- Netlify site deployed from this repo
- A Postgres database

### Step-by-step

1) Create a Postgres DB and copy the `DATABASE_URL`.

2) Run the schema:
- Fresh DB: run `sql/sync_schema.sql`
- If upgrading: apply migrations in order up to **`sql/migrate_v10.sql`**

3) Set Netlify environment variables:
- `DATABASE_URL`
- `SYNC_JWT_SECRET`
- `SYNC_INVITE_SECRET`

SSO secrets at rest (required if you configure OIDC client secrets or SAML SP private keys):
- `SYNC_SECRETS_KEY` (32 bytes, hex or base64)

Optional:
- `SYNC_ALLOWED_ORIGINS` (comma-separated allowlist)

4) Redeploy.

5) Open the Sync Console:
- Visit `/sync/`
- Create an org (this device becomes **owner**)
- Create invites and have teammates join
- Owner/admin clicks **Grant access** for each new member

## 3) SSO (OIDC / SAML)

OIDC:
- Configure via `/.netlify/functions/sso-oidc-set` (owner-only)
- Set redirect URI to: `https://YOUR_DOMAIN/sso/oidc/callback`

SAML:
- Configure via `/.netlify/functions/sso-saml-set` (owner-only)
- SP metadata: `https://YOUR_DOMAIN/sso/saml/metadata?orgId=YOUR_ORG_ID`
- Login endpoint: `https://YOUR_DOMAIN/sso/saml/login?orgId=YOUR_ORG_ID`
- ACS endpoint: `https://YOUR_DOMAIN/sso/saml/acs`

The Sync Console also includes buttons for OIDC/SAML sign-in.

## 4) SCIM provisioning

SCIM endpoints (use a SCIM token created by the org owner/admin):
- `https://YOUR_DOMAIN/scim/v2/Users`
- `https://YOUR_DOMAIN/scim/v2/Groups`

Group mappings can apply org roles and per‑vault grants.

## 5) WebAuthn (security keys)

WebAuthn registration + step‑up login is supported.

- Enroll from `/sync/` → “Enroll security key”
- Enforce via org policy (`policy.webauthn`):
  - `requireForLogin`: true
  - `enforceEnrollment`: true
  - `userVerification`: `preferred` or `required`
  - `allowedAAGUIDs`: optional allowlist

## 6) WORM audit retention + daily anchors (KMS)

`sql/migrate_v10.sql` makes `sync_audit` append-only (UPDATE/DELETE blocked) and adds `sync_audit_anchors`.

Daily anchor function:
- `/.netlify/functions/sync-audit-anchor-run` (admin JWT) or set `ANCHOR_RUN_TOKEN` and call with header `X-Anchor-Token`

Requires AWS KMS signing env:
- `AWS_REGION`
- `AUDIT_KMS_KEY_ID`
- (optional) `AUDIT_KMS_ALG`

List anchors:
- `/.netlify/functions/sync-audit-anchor-list`

## 7) Signed update channel

Publisher workflow lives in:
- `tools/README_RELEASE.md`

You can sign with a local key (never shipped) or AWS KMS.
