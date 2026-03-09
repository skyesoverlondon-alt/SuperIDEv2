# Phase 4 Ledger — Deployable Build Hardening

## Phase goal
Move the repo from a commercial skeleton toward an actual Cloudflare-deployable cumulative build.

## File count
- Files added this phase: 21
- Total repository file count: 205

## Routes and pages
- Route files: 25
- Endpoint count: 43
- UI pages: 19
- Migrations total: 9
- New migrations this phase: 2

## New files added this phase
- apps/web/.env.example
- apps/web/public/_headers
- apps/web/public/_redirects
- apps/web/src/lib/api.auth.ts
- apps/web/src/lib/api.bootstrap.ts
- apps/web/src/pages/FirstRun.tsx
- apps/web/src/vite-env.d.ts
- apps/worker-api/.dev.vars.example
- apps/worker-api/src/lib/bootstrap.ts
- apps/worker-api/src/lib/password.ts
- apps/worker-api/src/routes/bootstrap.ts
- docs/cloudflare-pages.md
- docs/deployable-release.md
- docs/env-matrix.md
- docs/phase-4-ledger.md
- docs/runbook.md
- docs/smoke-checklist.md
- infra/migrations/008_auth_and_sessions.sql
- infra/migrations/009_case_status_views.sql
- scripts/bootstrap-local.mjs
- scripts/release-smoke.mjs

## Major capability additions
1. D1-backed bootstrap auth account and session model
2. Login/logout worker routes
3. Password hashing helper
4. Bootstrap route and first-run page
5. Worker deploy config hardening via wrangler.toml
6. Worker `.dev.vars.example`
7. Web `.env.example`
8. Cloudflare Pages `_headers`
9. Cloudflare Pages `_redirects`
10. Signed export pack metadata
11. Operator runbook
12. Environment matrix and smoke checklist
13. Release smoke script
14. Local bootstrap script
15. D1 view for case status summary

## Exact new routes/endpoints added this phase
- POST /v1/auth/login
- POST /v1/auth/register
- POST /v1/auth/logout
- POST /v1/bootstrap

## Exact migrations added this phase
- 008_auth_and_sessions.sql
- 009_case_status_views.sql

## Deploy notes
This is a cumulative repo build with explicit Cloudflare deployment plumbing added. It is materially closer to deployment than the prior skeleton-oriented phases because it now includes auth/session schema, first-run bootstrap, worker secrets template, frontend env template, and Pages delivery config files.

## Honesty note
This phase is aimed at deployability. It is still not represented as a fully verified production release until the deploy checklist is run against a real Cloudflare account with live D1/KV/R2 bindings and a successful smoke pass.
