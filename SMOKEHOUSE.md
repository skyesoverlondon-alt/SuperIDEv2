# Smokehouse

This repository includes a one-shot smoke runner:

- Script: `scripts/smokehouse.sh`

## Run

```bash
cd /workspaces/SuperIDEv2
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app
```

Optional Worker health check:

```bash
WORKER_URL="https://<your-worker-domain>.workers.dev" ./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app
```

## Current Smoke Record (2026-03-04T00:29:11Z)

- PASS `GET /`
- SKIP Worker health (no `WORKER_URL` provided at run time)
- FAIL `POST /api/kaixu-generate` -> `401 Unauthorized`
- PASS `GET /api/auth-me`

Summary: `PASS=2 FAIL=1`

## Interpretation

- Frontend deploy is live.
- Netlify Functions are deployed and reachable.
- `kaixu-generate` is protected and currently requires valid session/auth context.
- Worker health can be validated immediately once `WORKER_URL` is set.

## Current Smoke Record (2026-03-04T00:35:22Z)

Command:

```bash
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://kaixu-superide-runner.skyesoverlondon.workers.dev
```

Results:

- PASS `GET /` -> `200`
- FAIL `GET https://kaixu-superide-runner.skyesoverlondon.workers.dev/health` -> `302`
- FAIL `POST /api/kaixu-generate` -> `401 Unauthorized`
- PASS `GET /api/auth-me` -> `200`

Summary: `PASS=2 FAIL=2`

### Interpretation

- Worker domain is reachable but Cloudflare Access is intercepting unauthenticated health checks (302 redirect to Access flow).
- Generate API is protected and requires authenticated app/session context.
- Frontend and auth-me route remain healthy.
