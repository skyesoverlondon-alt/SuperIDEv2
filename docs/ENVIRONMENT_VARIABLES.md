# Environment Variables Reference

This file is the single source of truth for environment variables used by this repository.

Example files:

- Root Netlify example: [/.env.netlify.example](../.env.netlify.example)
- Full production template: [/.env.production.example](../.env.production.example)
- Worker local example: [worker/.dev.vars.example](../worker/.dev.vars.example)

Use it to answer three questions quickly:

1. What is actually required for production to work?
2. Which runtime needs each variable?
3. Which variables are optional, legacy, or prototype-only?

## Quick Answer

If you are deploying the main secured app, the critical production variables are:

### Netlify site or Netlify Functions

- `NEON_DATABASE_URL`
- `WORKER_RUNNER_URL`
- `RUNNER_SHARED_SECRET`
- `KAIXU_GATEWAY_ENDPOINT`
- `KAIXU_APP_TOKEN`

Example file: [/.env.netlify.example](../.env.netlify.example)

### Cloudflare Worker

- `NEON_DATABASE_URL`
- `RUNNER_SHARED_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `NETLIFY_TOKEN_MASTER_KEY`
- `KAIXU_BACKUP_ENDPOINT` and `KAIXU_APP_TOKEN` when backup-brain failover is enabled

Example file: [worker/.dev.vars.example](../worker/.dev.vars.example)

### Worker bindings

- `KX_SECRETS_KV`
- `KX_EVIDENCE_R2`

The `VITE_*` variables are frontend build-time overrides. Most of them are not required because the code already has fallbacks.

If you want a single copy-paste baseline that covers the end-to-end production runtime, start from [/.env.production.example](../.env.production.example) and then split the values into Netlify site settings, Worker secrets, and Docker env usage as appropriate.

## Frontend Build Variables

These are used by the Vite frontend build in [src/App.tsx](../src/App.tsx).

### Optional build-time overrides

| Variable | Required | Used for | Fallback |
|---|---|---|---|
| `VITE_WORKER_RUNNER_URL` | no | Default Worker URL shown or used by frontend tools | placeholder Worker URL |
| `VITE_DEFAULT_WS_ID` | no | Default workspace context in frontend | `primary-workspace` |
| `VITE_SITE_BASE_URL` | no | Base URL metadata in frontend | `window.location.origin` |
| `VITE_APP_VERSION` | no | Build metadata shown in UI | `dev` |
| `VITE_GIT_SHA` | no | Build metadata shown in UI | `local` |
| `VITE_BUILD_TIME` | no | Build metadata shown in UI | current timestamp |

### Important note about Vite

`VITE_*` variables are not backend secrets.

They are frontend build-time values that Vite injects into the bundled app. If you do not set them, the app usually still works because this repo uses defaults for the currently referenced ones.

### Critical security note for public kAIxu apps

Do not inject shared provider master keys into public static apps under `public/kAI*/` or `public/kAix*/` using `VITE_*` variables or any other build-time env substitution.

Those files are shipped to the browser. Any provider key inserted there becomes a public client secret and is effectively disclosed to every user.

If a public kAIxu app must run direct-provider mode, it must use one of these paths instead:

1. A user-supplied personal provider key stored client-side for that user session.
2. A server-side backup brain route that keeps provider secrets on Netlify Functions or the Worker.
3. A secured gateway path such as `/api/kaixu-generate`.

## Netlify Functions Variables

These are used by files under [netlify/functions](../netlify/functions).

### Core production variables

| Variable | Required | Purpose |
|---|---|---|
| `NEON_DATABASE_URL` | yes | Neon database connection used by Netlify Functions |
| `WORKER_RUNNER_URL` | yes | URL of the deployed Cloudflare Worker runner |
| `RUNNER_SHARED_SECRET` | yes | Shared secret for authenticated Netlify-to-Worker calls |
| `KAIXU_GATEWAY_ENDPOINT` | yes | Protected AI gateway endpoint |
| `KAIXU_APP_TOKEN` | yes | Server token used to call the AI gateway |

### Optional gateway or auth hardening variables

| Variable | Required | Purpose |
|---|---|---|
| `KAIXU_GATEWAY_PROVIDER` | no | Display or route label for the gateway provider |
| `KAIXU_GATEWAY_MODEL` | no | Default model name used by gateway-backed generation |
| `TOKEN_MASTER_SEQUENCE` | no | Extra privileged override path for token-lock-sensitive actions |
| `Founders_GateWay_Key` | no | Founder-only browser bypass that boots a real owner session and unlocked admin runtime key without the normal login flow |
| `Founders_GateWay_Email` | no but recommended when multiple owner accounts exist | Pins founder-gateway activation to a specific owner email instead of falling back to the first owner account found |
| `CF_ACCESS_CLIENT_ID` | no | Service token client ID when Worker is protected by Cloudflare Access |
| `CF_ACCESS_CLIENT_SECRET` | no | Service token secret when Worker is protected by Cloudflare Access |

### Optional Contractor Network bridge variables

| Variable | Required | Purpose |
|---|---|---|
| `CONTRACTOR_NETWORK_ORG_ID` | yes for `/api/intake` on the main runtime | Org that owns public Contractor Network submissions and sovereign event fanout |
| `CONTRACTOR_NETWORK_WS_ID` | no | Workspace scope used for intake timeline entries when submissions should land in a specific workspace |
| `CONTRACTOR_NETWORK_MISSION_ID` | no | Mission scope used to auto-attach incoming submissions as mission assets and timeline activity |
| `ADMIN_PASSWORD` | yes for ContractorNetwork admin password login on the main runtime | Password-based admin lane for `/api/admin/login` |
| `ADMIN_JWT_SECRET` | yes for ContractorNetwork admin auth on the main runtime | Signs and verifies admin bearer tokens used by the public ContractorNetwork surface |
| `ADMIN_EMAIL_ALLOWLIST` | no | Comma-separated allowlist for optional Netlify Identity admin login |
| `ADMIN_IDENTITY_ANYONE` | no | If `true`, any authenticated Netlify Identity user can access ContractorNetwork admin routes |

### Mail and onboarding variables

| Variable | Required | Purpose |
|---|---|---|
| `SMTP_HOST` | no | SMTP host for outbound mail |
| `SMTP_PORT` | no | SMTP port |
| `SMTP_USER` | no | SMTP username |
| `SMTP_PASS` | no | SMTP password |
| `MAIL_FROM` | no | Explicit default sender address |
| `SKYE_MAIL_FROM` | no | Fallback branded sender address |
| `RESEND_API_KEY` | no | Fallback provider for outbound mail when SMTP is not configured |
| `MAIL_INGEST_SECRET` | no | Secret used by inbound mail ingest endpoint |

### Practical rule

For the main app to work in production, start with the five core production variables first. Add mail or Access variables only if you are actually using those features.

If you want founder bypass on the live Netlify runtime, set `Founders_GateWay_Key` in Netlify. The current implementation is intentionally Netlify-side because it creates the browser session and kAIxU token at the same boundary where login already lives.

## Cloudflare Worker Variables and Secrets

These are used by files under [worker/src](../worker/src).

Deployment note:

Secrets belong on the code Worker service declared in [worker/wrangler.toml](/workspaces/SuperIDEv2/worker/wrangler.toml). This repo's Worker is not a static-assets-only Worker; it is a code Worker with `main = "src/index.ts"` and the service name `kaixu-superide-runner`.
If Cloudflare shows the message that secret variables cannot be added to a Worker that only has static assets, you are in the wrong dashboard target and need to switch to the deployed code Worker service or redeploy it with `npm run deploy:worker`.

### Required Worker secrets or vars

| Variable | Required | Purpose |
|---|---|---|
| `NEON_DATABASE_URL` | yes | Worker-side access to Neon |
| `RUNNER_SHARED_SECRET` | yes | Verifies Netlify-to-Worker requests |
| `GITHUB_APP_ID` | yes for GitHub push | GitHub App ID used to mint installation tokens |
| `GITHUB_APP_PRIVATE_KEY` | yes for GitHub push | GitHub App private key |
| `NETLIFY_TOKEN_MASTER_KEY` | yes for Netlify connect and deploy | Encrypts vaulted Netlify tokens |
| `EVIDENCE_SIGNING_KEY` | yes for evidence export features | Signs evidence download URLs and packs |

### Optional Worker vars

| Variable | Required | Purpose |
|---|---|---|
| `ALLOW_ORIGINS` | no | CORS allowlist for Worker routes |
| `ACCESS_AUD` | no | Enables Cloudflare Access JWT verification |
| `ACCESS_ISSUER` | no | Expected Cloudflare Access issuer |
| `ACCESS_JWKS_URL` | no | JWKS URL for Access JWT verification |
| `KAIXU_BACKUP_ENDPOINT` | no | Dedicated upstream endpoint for the Worker backup brain |
| `KAIXU_APP_TOKEN` | no | Same server-side app token used by Netlify when the backup brain shares the same bearer credential |
| `KAIXU_BACKUP_TOKEN` | no | Optional override token if the backup brain uses a different bearer credential |
| `KAIXU_BACKUP_PROVIDER` | no | Label used in backup-brain responses and routing |
| `KAIXU_BACKUP_MODEL` | no | Default model used by the backup brain |
| `KAIXU_GATEWAY_PROVIDER` | no | Optional provider label fallback shared with Netlify AI routes |
| `KAIXU_GATEWAY_MODEL` | no | Optional model fallback shared with Netlify AI routes |

### Worker bindings

| Binding | Required | Purpose |
|---|---|---|
| `KX_SECRETS_KV` | yes for vaulted Netlify tokens | KV storage for encrypted provider secrets |
| `KX_EVIDENCE_R2` | yes for evidence export | R2 bucket for evidence archives |

## Variables Mentioned In README But Not Used By Current Main Runtime

These appear in docs or historical notes, but they are not part of the current main secured runtime path shown by the code scan:

| Variable | Status | Notes |
|---|---|---|
| `VITE_GITHUB_APP_INSTALL_URL` | legacy-doc reference | Mentioned in README, not part of the current scanned frontend env usage |
| `GITHUB_TOKEN_MASTER_KEY` | reserved or future-facing | Mentioned in README Worker section; current active Netlify vault flow uses `NETLIFY_TOKEN_MASTER_KEY` |

## Prototype-Only Legacy Variables

These belong to the old provider-direct prototype now archived in [artifacts/legacy-archive/Prototype-SkyDex4.6](/workspaces/SuperIDEv2/artifacts/legacy-archive/Prototype-SkyDex4.6). They are not required for the secured main app runtime.

| Variable | Used by |
|---|---|
| `OPENAI_API_KEY` | prototype Netlify functions |
| `OPENAI_CODEX_MODEL` | prototype Netlify functions |
| `OPENAI_RESPONSES_URL` | prototype Netlify functions |
| `GITHUB_TOKEN` | prototype Netlify functions |
| `NETLIFY_TOKEN` | prototype Netlify functions |
| `DEFAULT_GH_OWNER` | prototype defaults |
| `DEFAULT_GH_REPO` | prototype defaults |
| `DEFAULT_GH_BRANCH` | prototype defaults |
| `DEFAULT_NETLIFY_SITE_ID` | prototype defaults |

## Suggested Netlify Setup Order

If you are configuring production from scratch, do it in this order:

1. Set `NEON_DATABASE_URL` in Netlify and in the Worker.
2. Deploy the Worker and copy its real URL into `WORKER_RUNNER_URL`.
3. Set the same `RUNNER_SHARED_SECRET` in Netlify and Worker.
4. Set `KAIXU_GATEWAY_ENDPOINT` and `KAIXU_APP_TOKEN` in Netlify.
5. If you want automatic backup-brain failover, set `KAIXU_BACKUP_ENDPOINT` and the same `KAIXU_APP_TOKEN` on the Worker, or set `KAIXU_BACKUP_TOKEN` if the backup route uses a different credential.
6. If you want founder bypass in the live browser shell, set `Founders_GateWay_Key` in Netlify and optionally `Founders_GateWay_Email`.
7. Add `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to the Worker if GitHub push is needed.
8. Add `NETLIFY_TOKEN_MASTER_KEY` and `KX_SECRETS_KV` if Netlify site connection and deploy are needed.
9. Add mail variables only if onboarding mail, reset mail, or inbox features are required.

## SQL Note

Environment variables are separate from schema setup.

For Neon, rerun [db/schema.sql](../db/schema.sql) if you are not sure your database already has the latest tables, indexes, and additive columns. The file is written to be largely idempotent.