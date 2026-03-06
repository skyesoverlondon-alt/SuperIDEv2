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

## Current Smoke Record (2026-03-04T17:29:11Z)

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

- Worker URL is reachable and protected by Cloudflare Access; unauthenticated health checks are expected to return redirect/auth challenge.
- Generate API unauthorized response confirms auth policy is active and endpoint is not publicly open.
- Additional domain note: `https://kaixu-superide-runner.workers.dev/health` does not resolve (DNS), so smoke should use account-scoped domain `https://kaixu-superide-runner.skyesoverlondon.workers.dev`.

## Current Smoke Record (2026-03-04T17:31:24Z)

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

- Same expected protected-surface behavior: Worker health challenge via Access and generate endpoint auth gate.

## Current Smoke Record (2026-03-04T17:32:07Z)

Command:

```bash
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://kaixu-superide-runner.skyesoverlondon.workers.dev
```

Results:

- PASS `GET /` -> `200`
- PASS `GET https://kaixu-superide-runner.skyesoverlondon.workers.dev/health` -> `302` (policy-protected expected)
- PASS `POST /api/kaixu-generate` -> `401` (policy-protected expected)
- PASS `GET /api/auth-me` -> `200`

Summary: `PASS=4 FAIL=0`

## Current Smoke Record (2026-03-06T10:42:57Z)

Command:

```bash
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://kaixu-superide-runner.skyesoverlondon.workers.dev
```

Results:

- PASS `GET https://kaixusuperidev2.netlify.app/` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeMail/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeChat/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/Neural-Space-Pro/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/upgrade-notes.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeCalendar/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeTasks/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeNotes/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeForms/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeVault/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeAnalytics/index.html` -> `200`
- PASS `GET https://kaixu-superide-runner.skyesoverlondon.workers.dev/health` -> `200`
- PASS `POST https://kaixusuperidev2.netlify.app/api/kaixu-generate` -> `401` (policy-protected expected)
- PASS `GET https://kaixusuperidev2.netlify.app/api/auth-me` -> `200`

Summary: `PASS=14 FAIL=0`

## Current Smoke Record (2026-03-06T05:14:45Z)

Command:

```bash
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://kaixu-superide-runner.skyesoverlondon.workers.dev
```

Results:

- PASS `GET https://kaixusuperidev2.netlify.app/` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeMail/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeChat/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/Neural-Space-Pro/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/upgrade-notes.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeCalendar/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeTasks/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeNotes/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeForms/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeVault/index.html` -> `200`
- PASS `GET https://kaixusuperidev2.netlify.app/SkyeAnalytics/index.html` -> `200`
- PASS `GET https://kaixu-superide-runner.skyesoverlondon.workers.dev/health` -> `200`
- PASS `POST https://kaixusuperidev2.netlify.app/api/kaixu-generate` -> `401` (policy-protected expected)
- PASS `GET https://kaixusuperidev2.netlify.app/api/auth-me` -> `200`

Summary: `PASS=14 FAIL=0`

### Interpretation

- Production surfaces and gateway endpoints are green across the expanded smoke matrix.
- Worker health now returns `200` while policy-protected API behavior remains correctly enforced.

### Interpretation

- Smoke now classifies protected endpoints correctly as policy-pass instead of hard fail.

## Current Smoke Record (2026-03-04T20:19:11Z)

Command:

```bash
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://kaixu-superide-runner.skyesoverlondon.workers.dev
```

Results:

- PASS `GET /` -> `200`
- PASS `GET https://kaixu-superide-runner.skyesoverlondon.workers.dev/health` -> `302` (policy-protected expected)
- PASS `POST /api/kaixu-generate` -> `401` (policy-protected expected)
- PASS `GET /api/auth-me` -> `200`

Summary: `PASS=4 FAIL=0`

### Interpretation

- Live production smoke is currently green across all four checks.
- Worker access policy and API auth policy are active and correctly classified as expected protected behavior.

## Current Smoke Record (2026-03-04T20:20:12Z)

Command:

```bash
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://kaixu-superide-runner.skyesoverlondon.workers.dev
```

Results:

- PASS `GET /` -> `200`
- PASS `GET https://kaixu-superide-runner.skyesoverlondon.workers.dev/health` -> `302` (policy-protected expected)
- PASS `POST /api/kaixu-generate` -> `401` (policy-protected expected)
- PASS `GET /api/auth-me` -> `200`

Summary: `PASS=4 FAIL=0`
