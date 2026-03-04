# Supreme Smoke Runbook

This runbook is the operational proof package for production readiness.

## Objective

Prove the platform is secure, healthy, policy-enforced, and reproducible under load.

## Required Environment

- Netlify envs set and active (`NEON_DATABASE_URL`, `KAIXU_GATEWAY_ENDPOINT`, `KAIXU_APP_TOKEN`, `WORKER_RUNNER_URL`, `TOKEN_MASTER_SEQUENCE`, `RESEND_API_KEY`).
- Worker deployed with matching secrets and Access policy if enabled.
- Database schema current (including `api_tokens.locked_email` and `api_tokens.scopes_json`).

## Smoke Layers

### Layer 1 — Core Health

- Site root returns `200`.
- Worker `/health` returns `200`.
- Auth session resolution route returns expected identity/unauth behavior.

### Layer 2 — Gate & Policy

- Token issue/list/revoke end-to-end works.
- 2-minute token expires and is rejected after TTL.
- Email lock mismatch is rejected.
- Master sequence override behavior works only with correct secret.
- Scope denial works (`generate` route denies token missing required scope).

### Layer 3 — AI + SKNore

- AI generate succeeds with valid auth and permitted files.
- SKNore-protected active file is blocked.
- SKNore-protected files are excluded from AI payload set.

### Layer 4 — App Integrations

- SkyeMail send returns provider ID and persisted record.
- SkyeChat notify persists event record.
- Optional mail→chat hook writes linked notification record.

## Commands

### Base smoke

```bash
cd /workspaces/SuperIDEv2
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app https://<worker-domain>
```

### Build verification

```bash
npm run build
```

### Token 2-minute scenario (manual)

1. Issue token with `ttl_preset=test_2m`.
2. Call `kaixu-generate` with token + `X-Token-Email` before expiry (expect success).
3. Wait >2m.
4. Repeat call (expect unauthorized/expired behavior).

## Evidence Pack Requirements

- Timestamped command output logs.
- Endpoint status captures (request/response with sensitive values redacted).
- Token lifecycle evidence (issued → used → expired/revoked).
- SKNore denial evidence.
- Provider integration evidence (mail/chat record IDs).

## Acceptance Gates

- All Layer 1 checks passing.
- All policy checks passing with negative tests proving denial.
- No critical errors in logs for smoke window.
- Reproducible run performed by second operator.

## Cadence

- Auto smoke: every 13 minutes.
- Full Supreme Smoke: at least daily + before every production release.
