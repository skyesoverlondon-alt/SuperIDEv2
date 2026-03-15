# ENV LAUNCH CHECKLIST

Use this when updating the live site. The source of truth remains [/.env.production.example](../.env.production.example), with supporting guidance in [../docs/ENVIRONMENT_VARIABLES.md](../docs/ENVIRONMENT_VARIABLES.md) and [../docs/DEPLOYMENT_ENV_CHECKLIST.md](../docs/DEPLOYMENT_ENV_CHECKLIST.md).

## Netlify Site Variables

Set these in the Netlify site for the main app and Netlify Functions.

### Required

```dotenv
NEON_DATABASE_URL=postgres://app_user:replace-me@db.neon.tech/superide?sslmode=require
WORKER_RUNNER_URL=https://kaixu-superide-runner.your-account.workers.dev
RUNNER_SHARED_SECRET=replace-with-32-plus-char-shared-secret
KAIXU_GATEWAY_ENDPOINT=https://skyesol.netlify.app/.netlify/functions/gateway-chat
KAIXU_APP_TOKEN=replace-with-server-app-token
```

### Recommended Or Optional

```dotenv
KAIXU_GATEWAY_PROVIDER=openai-responses
KAIXU_GATEWAY_MODEL=gpt-5.4
TOKEN_MASTER_SEQUENCE=replace-with-founder-override-sequence
Founders_GateWay_Key=replace-with-founder-browser-bypass-key
Founders_GateWay_Email=founder@your-domain.com
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=noreply@your-domain.com
SKYE_MAIL_FROM=Skye Mail <noreply@your-domain.com>
RESEND_API_KEY=
MAIL_INGEST_SECRET=

CONTRACTOR_NETWORK_ORG_ID=
CONTRACTOR_NETWORK_WS_ID=
CONTRACTOR_NETWORK_MISSION_ID=
ADMIN_PASSWORD=
ADMIN_JWT_SECRET=
ADMIN_EMAIL_ALLOWLIST=
ADMIN_IDENTITY_ANYONE=false
```

## Cloudflare Worker Secrets Or Vars

Set these on the deployed code Worker service, not in the frontend.

### Required When Those Lanes Are Enabled

```dotenv
NEON_DATABASE_URL=postgres://app_user:replace-me@db.neon.tech/superide?sslmode=require
RUNNER_SHARED_SECRET=replace-with-32-plus-char-shared-secret
GITHUB_APP_ID=1234567
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-me\n-----END PRIVATE KEY-----"
NETLIFY_TOKEN_MASTER_KEY=replace-with-32-plus-char-netlify-vault-key
EVIDENCE_SIGNING_KEY=replace-with-32-plus-char-evidence-signing-key
```

### Optional Worker Runtime Values

```dotenv
KAIXU_BACKUP_ENDPOINT=https://api.openai.com/v1/responses
KAIXU_APP_TOKEN=replace-with-server-app-token
KAIXU_BACKUP_TOKEN=
KAIXU_BACKUP_PROVIDER=openai-responses
KAIXU_BACKUP_MODEL=gpt-5.4
ALLOW_ORIGINS=https://your-site.example.com
ACCESS_AUD=
ACCESS_ISSUER=
ACCESS_JWKS_URL=
KAIXU_GATEWAY_PROVIDER=openai-responses
KAIXU_GATEWAY_MODEL=gpt-5.4
```

### Worker Bindings

These are not normal env vars. Configure them in [../worker/wrangler.toml](../worker/wrangler.toml):

- `KX_SECRETS_KV`
- `KX_EVIDENCE_R2`

## Safe VITE Production Values

These are frontend build-time values only. They are safe because they are not secret credentials.

```dotenv
NODE_VERSION=22.14.0
SITE_PORT=8080
VITE_WORKER_RUNNER_URL=https://your-worker.example.workers.dev
VITE_DEFAULT_WS_ID=primary-workspace
VITE_SITE_BASE_URL=https://your-site.example.com
VITE_APP_VERSION=production
VITE_GIT_SHA=replace-with-git-sha
VITE_BUILD_TIME=2026-03-09T00:00:00Z
VITE_GITHUB_APP_INSTALL_URL=https://github.com/apps/your-app/installations/new
```

Do not put secrets into any `VITE_*` variable.

## Fast Live Checklist

1. Put the 5 required Netlify vars in Netlify.
2. Put `NEON_DATABASE_URL` and the same `RUNNER_SHARED_SECRET` in the Worker.
3. Add Worker secrets for GitHub, Netlify vault, and evidence only if you use those lanes.
4. Add `Founders_GateWay_Key` and `Founders_GateWay_Email` only if you want founder bypass live.
5. Keep `KX_SECRETS_KV` and `KX_EVIDENCE_R2` as Worker bindings, not site env vars.