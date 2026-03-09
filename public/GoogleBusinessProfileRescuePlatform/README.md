# Google Business Profile Rescue Platform — Phase 1

Cloudflare-native SaaS foundation for diagnosing Google Business Profile suspensions, generating reinstatement packages, organizing evidence, and tracking cases.

## What Phase 1 includes

- marketing landing page
- app shell with dashboard, new case wizard, case detail page, billing, settings, and admin pages
- Cloudflare Worker API using Hono
- D1-ready schema and seed migrations
- R2-ready evidence lane
- AI diagnostic generator and reinstatement draft generator
- local in-memory fallback when D1 is not attached
- Phase 1 file ledger and route ledger

## Stack

- Cloudflare Pages / static frontend
- React + Vite + TypeScript
- Cloudflare Worker + Hono
- D1 for relational storage
- R2 for evidence file objects
- KV-ready config hooks

## Workspace layout

- `apps/web` — browser app
- `apps/worker-api` — Worker API brain
- `packages/*` — shared surface for future phases
- `infra/migrations` — D1 SQL migrations
- `docs` — architecture, routes, deployment, phase ledger
- `scripts` — repo verification and support utilities

## Quick start

### 1) Install
```bash
npm install
```

### 2) Frontend dev
```bash
npm run dev:web
```

### 3) Worker dev
```bash
npm run dev:api
```

### 4) Verify phase
```bash
npm run verify:phase1
```

## Cloudflare resources expected later

- D1 database binding: `DB`
- R2 bucket binding: `EVIDENCE_BUCKET`
- KV namespace binding: `APP_KV`
- AI provider secret: `OPENAI_API_KEY` or your routed gateway secret

Phase 1 is the real foundation layer, not the final hardening pass. The repo is intentionally structured for additive expansion into subscriptions, monitoring jobs, tenant roles, exports, audit logging, and agency mode.


## Phase 3 Additions

- workspaces and members
- queue-backed execution surface
- analytics and support tooling
- trust center and feature flags
- signed export primitives


## Phase 5 — Production Closeout
This cumulative phase adds stricter auth defaults, workspace-scoped case ownership, Cloudflare resource wiring placeholders, release-readiness endpoints, smoke routes, and closeout scripts intended to move the repo from deploy-shaped to real deployment candidate.
