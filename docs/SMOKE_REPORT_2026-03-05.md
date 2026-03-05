# Smoke Report - 2026-03-05

## Scope
- Smokehouse contract run via `bash scripts/smokehouse.sh`
- Explicit per-route GET sweep for regenerated kAIxu standalone pages
- Target site: `https://kaixusuperidev2.netlify.app`

## Smokehouse Result
- Timestamp (UTC): `2026-03-05T11:57:29Z`
- Summary: `PASS=13 FAIL=0`
- Notes:
- Worker health check skipped because `WORKER_URL` was not provided.
- `POST /api/kaixu-generate` returned `401` and was treated as expected policy protection.
- `GET /api/auth-me` returned `200` in this run.

## kAIxu Route Sweep
All regenerated routes returned HTTP `200`:
- `/kAIxU-Vision/index.html`
- `/kAixu-Nexus/index.html`
- `/kAIxU-Codex/index.html`
- `/kAIxu-Atmos/index.html`
- `/kAIxu-Quest/index.html`
- `/kAIxu-Forge/index.html`
- `/kAIxU-Matrix/index.html`
- `/kAIxu-Atlas/index.html`
- `/kAixU-Chronos/index.html`
- `/kAIxu-Bestiary/index.html`
- `/kAIxu-Mythos/index.html`
- `/kAIxU-Faction/index.html`
- `/kAIxU-PrimeCommand/index.html`

## Conclusion
Smoke validation passed for the contract suite and all 13 regenerated kAIxu routes at the time of execution.
