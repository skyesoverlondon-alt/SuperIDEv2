# Deployed Environment Audit

Date: 2026-03-07

This audit compares the deployed Netlify site and Cloudflare Worker setup against the canonical checklist in [docs/ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

## Scope

What was verified:

- Repo runtime variable usage from code and config
- Public reachability of the deployed Netlify site
- Public reachability of the deployed Worker health route
- Local availability of `netlify-cli` and `wrangler`

What could not be verified directly from this container:

- Actual deployed Netlify environment variable values
- Actual deployed Cloudflare Worker secrets and remote vars

Reason:

- `netlify-cli` is installed but not authenticated
- `wrangler` is installed but not authenticated

## Direct Checks Performed

### CLI access

- `npx netlify-cli --version`: available
- `npx wrangler --version`: available
- `npx netlify-cli status`: not logged in
- `npx wrangler whoami`: not authenticated

### Public endpoint probes

- `https://kaixusuperidev2.netlify.app`: returned `HTTP 200`
- `https://kaixu-superide-runner.skyesoverlondon.workers.dev/health`: returned `HTTP 200`

## Audit Matrix

### Netlify site / Netlify Functions checklist

| Variable | Expected | Audit status | Notes |
|---|---|---|---|
| `NEON_DATABASE_URL` | required | unknown | Cannot inspect deployed Netlify envs without Netlify auth |
| `WORKER_RUNNER_URL` | required | partially verified | Frontend and docs point at `https://kaixu-superide-runner.skyesoverlondon.workers.dev`; public Worker responds |
| `RUNNER_SHARED_SECRET` | required | unknown | Secret value not auditable without Netlify and Worker auth |
| `KAIXU_GATEWAY_ENDPOINT` | required | unknown | No direct secret/env listing available |
| `KAIXU_APP_TOKEN` | required | unknown | No direct secret/env listing available |
| `CF_ACCESS_CLIENT_ID` | optional | unknown | Not auditable from public probes |
| `CF_ACCESS_CLIENT_SECRET` | optional | unknown | Not auditable from public probes |
| mail variables | optional | unknown | Not auditable from public probes |
| `VITE_*` build vars | optional | partially verified | App has runtime fallbacks; missing values would not necessarily break production |

### Cloudflare Worker checklist

| Variable or binding | Expected | Audit status | Notes |
|---|---|---|---|
| `NEON_DATABASE_URL` | required | unknown | Secret not auditable without Wrangler auth |
| `RUNNER_SHARED_SECRET` | required | unknown | Secret not auditable without Wrangler auth |
| `GITHUB_APP_ID` | required for push | unknown | Not auditable without Wrangler auth |
| `GITHUB_APP_PRIVATE_KEY` | required for push | unknown | Not auditable without Wrangler auth |
| `NETLIFY_TOKEN_MASTER_KEY` | required for deploy | unknown | Not auditable without Wrangler auth |
| `EVIDENCE_SIGNING_KEY` | required for evidence export | unknown | Not auditable without Wrangler auth |
| `ALLOW_ORIGINS` | optional | repo-configured | Present in [worker/wrangler.toml](../worker/wrangler.toml) |
| `ACCESS_AUD` | optional or required if Access enforced | repo-configured | Present in [worker/wrangler.toml](../worker/wrangler.toml) |
| `ACCESS_ISSUER` | optional or required if Access enforced | repo-configured | Present in [worker/wrangler.toml](../worker/wrangler.toml) |
| `ACCESS_JWKS_URL` | optional or required if Access enforced | repo-configured | Present in [worker/wrangler.toml](../worker/wrangler.toml) |
| `KX_SECRETS_KV` | required binding | repo-configured | Present in [worker/wrangler.toml](../worker/wrangler.toml) |
| `KX_EVIDENCE_R2` | required binding | repo-configured | Present in [worker/wrangler.toml](../worker/wrangler.toml) |

## Practical Conclusion

The deployment endpoints are live and the repo-side runtime contract is defined, but the secret audit is incomplete because this container is not authenticated to the actual Netlify account or Cloudflare account.

So the honest status is:

- Public deployment presence: verified
- Repo checklist and example files: verified
- Deployed secret parity against checklist: not verifiable from current auth state

## Exact Next Commands To Complete The Audit

Once authenticated locally, run:

### Netlify

```bash
npx netlify-cli login
npx netlify-cli status
npx netlify-cli env:list
```

### Cloudflare Worker

```bash
cd worker
npx wrangler login
npx wrangler whoami
npx wrangler secret list
```

Then compare the outputs against [docs/ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md), [/.env.netlify.example](../.env.netlify.example), and [worker/.dev.vars.example](../worker/.dev.vars.example).