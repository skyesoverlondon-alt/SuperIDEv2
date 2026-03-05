# SKNore Product Surface
SIR 
Version: 1.0.0

## Standalone App
- Path: `public/SKNore/index.html`
- Deploy surface: Netlify static page
- Access model: same auth/session as SuperIDE (`/api/auth-*`)

## Backend API Surface
- `GET /api/sknore-policy-get`  : load org/workspace policy
- `POST /api/sknore-policy-set` : save org/workspace policy
- `GET /api/sknore-events`      : blocked-event stream (audit-backed)

## Enforcement Surface
- `POST /api/kaixu-generate`
  - server-side SKNore policy resolution
  - blocks protected `activePath`
  - strips protected files from payload
  - emits audit events for blocked attempts

## Packaging / Versioning
- Product docs: `SKNore/ARCHITECTURE.md`, `SKNore/PRODUCT_SURFACE.md`
- Current release tag (manual): `SKNore v1.0.0`
- Release gate:
  1. policy CRUD smoke
  2. blocked event capture smoke
  3. generate endpoint block test

## Deploy Notes
- Requires standard Netlify API env set (DB/auth runtime)
- No special SKNore-only env vars required in this version

## Smoke Evidence (2026-03-05)
- Baseline production smoke (`scripts/smokehouse.sh`)
  - Summary: `PASS=13 FAIL=0`
  - Site and standalone surfaces: all `200`
  - Generate API: `401` expected (policy-protected)
  - Auth Me API: `200`
- Authenticated kAIxU chat verification (`POST /api/skychat-kaixu`)
  - Result: `ok: true`
  - Provider path: `Skyes Over London`
  - Model path: `kAIxU-Prime6.7`
  - Returned `ai_record_id` and assistant output payload in production
