# Deployment Environment Checklist

Use this checklist when promoting the secured runtime. The goal is to separate what must exist for the app to boot from what only matters when a specific lane is enabled.

## Must Set Now

### Netlify site / Netlify Functions

- `NEON_DATABASE_URL`
- `WORKER_RUNNER_URL`
- `RUNNER_SHARED_SECRET`
- `KAIXU_GATEWAY_ENDPOINT`
- `KAIXU_APP_TOKEN`

### Cloudflare Worker

- `NEON_DATABASE_URL`
- `RUNNER_SHARED_SECRET`

### Worker bindings

- `KX_SECRETS_KV` if you will connect Netlify deploy credentials
- `KX_EVIDENCE_R2` if you will use evidence export flows

## Set Before Live Founder Testing

### Netlify site / Netlify Functions

- `Founders_GateWay_Key`
- `Founders_GateWay_Email` when more than one owner account exists

## Set If Backup Brain Is Enabled

### Cloudflare Worker

- `KAIXU_BACKUP_ENDPOINT`
- `KAIXU_APP_TOKEN` or `KAIXU_BACKUP_TOKEN`
- `KAIXU_BACKUP_PROVIDER`
- `KAIXU_BACKUP_MODEL`

## Set If GitHub Push Is Enabled

### Cloudflare Worker

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`

## Set If Netlify Connect / Deploy Is Enabled

### Cloudflare Worker

- `NETLIFY_TOKEN_MASTER_KEY`

## Set If Evidence Export Is Enabled

### Cloudflare Worker

- `EVIDENCE_SIGNING_KEY`

## Set If Cloudflare Access Protects The Worker

### Netlify site / Netlify Functions

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

### Cloudflare Worker

- `ACCESS_AUD`
- `ACCESS_ISSUER`
- `ACCESS_JWKS_URL`

## Set If Mail / Onboarding Flows Are Enabled

### Netlify site / Netlify Functions

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM` or `SKYE_MAIL_FROM`
- `RESEND_API_KEY` if using Resend instead of SMTP
- `MAIL_INGEST_SECRET` if inbound mail ingest is live

## Set If Contractor Intake Surfaces Are Live

### Netlify site / Netlify Functions

- `CONTRACTOR_NETWORK_ORG_ID`
- `CONTRACTOR_NETWORK_WS_ID` when intake must land in a fixed workspace
- `CONTRACTOR_NETWORK_MISSION_ID` when submissions should auto-attach to a mission
- `ADMIN_PASSWORD`
- `ADMIN_JWT_SECRET`
- `ADMIN_EMAIL_ALLOWLIST` when using allowlisted identity login
- `ADMIN_IDENTITY_ANYONE=true` only if any authenticated identity user should gain admin access

## Verification Pass

1. Confirm Netlify and Worker share the same `RUNNER_SHARED_SECRET`.
2. Confirm `WORKER_RUNNER_URL` points at the deployed code Worker, not a static asset domain.
3. Confirm the database has the latest additive schema from [db/schema.sql](../db/schema.sql).
4. Run `npm run test:auth-regression`.
5. Run `npm run check:gateway-only`.
6. Run `npm run check:secure-defaults`.