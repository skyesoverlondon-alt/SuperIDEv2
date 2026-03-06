---
description: "Use when editing worker/** runtime logic, including HMAC request verification, Cloudflare Access JWT checks, KV/R2 secret and evidence flows, and CORS behavior."
name: "Worker Runtime Guardrails"
applyTo: "worker/**"
---
# Worker Runtime Guardrails

## Scope
- Applies to `worker/**`.
- Focus areas: signed runner requests, access JWT enforcement, vault/evidence flows, and CORS behavior.

## Security-Critical Requirements
- Preserve and extend existing HMAC request verification; do not weaken signature checks, replay windows, or canonicalization rules.
- Preserve and extend Access JWT enforcement for protected routes.
- Keep public probe routes intentionally minimal (`/`, `/health`, `/favicon.ico` as designed) and avoid accidental exposure of privileged endpoints.

## Secret And Evidence Handling
- Never return raw secrets, private keys, or vault material in responses or logs.
- Keep provider secrets in KV/vault flows, not in frontend code or DB tables.
- Evidence pack and R2 interactions must remain explicit, traceable, and access-controlled.

## CORS And Headers
- Reuse existing CORS helpers/patterns in `worker/src/index.ts`.
- Keep CORS behavior deliberate: allow expected origins, methods, and headers only.
- Do not add wildcard behavior casually when route sensitivity is unknown.

## API Design Constraints
- Keep error messages safe-by-default (no internal stack or secret leakage).
- Maintain stable JSON shapes where existing clients depend on them.
- Prefer additive changes over breaking response contract changes.

## Validation Expectations
- For worker or gateway-shape-impacting edits, run relevant checks:
- `npm run check:gateway-only`
- `npm run test:gateway-shape`
- `npm run check:secure-defaults`
- For release confidence and runtime probe behavior:
- `./scripts/smokehouse.sh <site-url> <worker-url>`
