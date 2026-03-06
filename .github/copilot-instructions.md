# Project Guidelines

## Code Style
- Frontend stack is Vite + React + TypeScript in `src/` with Monaco editor usage in `src/App.tsx`.
- Serverless backend logic lives in Netlify Functions under `netlify/functions/` (TypeScript).
- Cloudflare Worker runtime logic lives in `worker/src/` (TypeScript).
- Prefer small, focused edits in existing modules instead of broad refactors.
- Keep security-sensitive behavior explicit and auditable; do not add silent fallbacks for auth or policy checks.

## Architecture
- This repo is a split-runtime system:
- Netlify site + functions handle app UI, auth/session, tenancy, and API routing (`/api/*` to functions via `netlify.toml`).
- Cloudflare Worker (`worker/`) handles privileged operations and vault/evidence flows.
- Data model and tenancy/audit primitives are defined in `db/schema.sql`.
- Public app surfaces and static modules live in `public/` and are synced from source folders before dev/build.
- SKNore policy enforcement is a core guardrail for AI payload protection (`src/sknore/` + enforcement in `src/App.tsx`).

## Build and Test
- Install dependencies: `npm install`
- Start local dev: `npm run dev`
- Production build: `npm run build`
- Surface sync (runs automatically before dev/build): `npm run sync:surfaces`
- Gateway and policy checks:
- `npm run check:gateway-only`
- `npm run check:protected-apps`
- `npm run check:provider-strings`
- `npm run check:secure-defaults`
- Contract/regression checks:
- `npm run test:gateway-shape`
- `npm run test:auth-regression`
- `npm run test:export-import-schema`
- Smoke/evidence flows:
- `npm run smoke:interactions`
- `./scripts/smokehouse.sh <site-url> <worker-url>`

## Conventions
- Keep tenant boundaries intact: org/workspace context must not be bypassed in API changes.
- Do not store external provider secrets in frontend code or database tables; secret vaulting belongs in Worker/KV flows.
- Prefer existing script entrypoints over ad hoc commands when validating changes.
- For static surface changes, verify sync assumptions (`sync:docxpro`, `sync:neural`, `sync:surfaces`).
- When changing auth/session behavior, update both implementation and relevant regression checks.

## Common Pitfalls
- `npm run dev` and `npm run build` rely on pre-scripts that sync surface directories; direct file edits in `public/` can be overwritten.
- Some smoke commands target external deployed URLs; do not assume they are safe for offline/local-only validation.
- Devcontainer config exists and may be in transition between `.devcontainer/` and `1.devcontainer/`; avoid hardcoding one path without checking current workspace state.
