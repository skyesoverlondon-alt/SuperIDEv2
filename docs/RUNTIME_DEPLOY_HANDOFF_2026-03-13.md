# Runtime Deploy Handoff

This handoff is the direct deployment path for the active SuperIDE runtime after the password reset fix, service-worker fix, schema authority cleanup, and Worker target verification.

## What Was Fixed In Repo

1. Password reset landings now force the dedicated recovery route instead of getting stranded on the homepage shell.
2. The main service worker now keeps `/recover-account/` in its own navigation cache/fallback path instead of collapsing failed navigations into cached `/index.html`.
3. The active SQL authority is now `db/schema.sql`; stale public Neon schema copies were removed.
4. The Cloudflare Worker target is explicitly the code Worker service defined in `worker/wrangler.toml` with `main = "src/index.ts"` and `workers_dev = true`.

## Current Shell Reality

From this workspace session:

1. `wrangler` is not authenticated in the current shell.
2. No Cloudflare deploy env vars were present in the shell.
3. No Netlify deploy env vars or local `.netlify/state.json` link state were present in the shell.

That means the repo is ready, but remote deployment still requires runtime credentials.

## Deployment Order

### 1. Neon

Apply the active schema file to the same production database used by Netlify Functions and the Worker.

Source of truth:

- `db/schema.sql`

Expected tables relevant to this fix set:

- `password_reset_tokens`
- `ai_brain_usage_log`
- `contractor_submissions`

If `ai_brain_usage_log` is still missing after applying SQL, the wrong Neon database is being updated.

### 2. Cloudflare Worker

Target service:

- Service name: `kaixu-superide-runner`
- Config file: `worker/wrangler.toml`
- Entrypoint: `worker/src/index.ts`

Authenticate and deploy:

```bash
cd /workspaces/SuperIDEv2/worker
npx wrangler login
npx wrangler deploy
```

Required secrets on the Worker service:

- `RUNNER_SHARED_SECRET`
- `NEON_DATABASE_URL`
- `EVIDENCE_SIGNING_KEY`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_TOKEN_MASTER_KEY`
- `NETLIFY_TOKEN_MASTER_KEY`
- `KAIXU_BACKUP_ENDPOINT` if backup route is used
- `KAIXU_BACKUP_TOKEN` if backup uses a distinct credential
- `KAIXU_APP_TOKEN` if backup route falls back to the same token

Required bindings already declared in repo:

- `KX_SECRETS_KV`
- `KX_EVIDENCE_R2`

Verification:

```bash
curl https://<worker-url>/health
```

Expected response:

```json
{"ok":true,"name":"kaixu-superide-runner"}
```

Important: if the Cloudflare UI says the resource only supports static assets, you are on the wrong Cloudflare resource. The deploy target is the Worker service defined by `worker/wrangler.toml`, not a Pages/static asset project.

### 3. Netlify

The site runtime is:

- publish dir: `dist`
- functions dir: `netlify/functions`
- API redirect: `/api/* -> /.netlify/functions/:splat`

Required Netlify environment variables:

- `NEON_DATABASE_URL`
- `WORKER_RUNNER_URL`
- `RUNNER_SHARED_SECRET`
- `KAIXU_GATEWAY_ENDPOINT`
- `KAIXU_APP_TOKEN`
- `CF_ACCESS_CLIENT_ID` if Worker is behind Cloudflare Access service-token policy
- `CF_ACCESS_CLIENT_SECRET` if Worker is behind Cloudflare Access service-token policy

After env verification, trigger a production deploy in one of these ways:

1. Push the repo changes through the connected Git workflow.
2. Or trigger a manual site deploy from Netlify UI.

### 4. Browser Cache Cutover

Because the fix includes a service-worker navigation change, test the live reset link only after forcing the new service worker to take control.

Use a hard refresh or clear site data once after deploy.

## Validation Commands

Run from repo root:

```bash
npm run check:runtime-deploy
npm run test:auth-regression
npm run build
```

Optional handoff printout:

```bash
npm run handoff:runtime
```

## Expected Live Outcome

1. Password reset links with `reset_email` and `reset_token` land on `/recover-account/` instead of the homepage shell.
2. Recovery navigations no longer fall back to cached homepage shell content.
3. Netlify and Worker both point at the same Neon schema authority: `db/schema.sql`.
4. Cloudflare secrets are added to the real Worker service instead of a static-asset surface.