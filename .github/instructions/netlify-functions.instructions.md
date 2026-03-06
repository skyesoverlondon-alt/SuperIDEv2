---
description: "Use when editing Netlify Functions in netlify/functions/**, including _shared/auth helpers, response helpers, tenancy checks, and API error shapes."
name: "Netlify Functions Guardrails"
applyTo: "netlify/functions/**"
---
# Netlify Functions Guardrails

## Scope
- Applies to files under `netlify/functions/**`.
- Focus areas: `_shared/auth`, `_shared/response`, auth/session behavior, org/workspace tenancy, and API payload/error contracts.

## Required Patterns
- Reuse shared helpers before adding new patterns:
- Auth/session logic belongs in `_shared/auth`.
- JSON/HTTP response formatting belongs in `_shared/response`.
- Keep function handlers thin; move reusable logic to `_shared/*` where practical.

## Tenancy And Access
- Enforce org/workspace boundaries on every data path.
- Never trust client-supplied org/workspace IDs without server-side verification against session/user context.
- Do not bypass tenancy checks for convenience, even in fallback paths.

## Error Shape
- Keep error responses structured and explicit.
- Prefer consistent status + body patterns used by existing functions.
- Do not leak internal details, stack traces, provider tokens, or signed payload contents in errors.

## Security Constraints
- Never place external provider secrets in function source or returned payloads.
- Secret vaulting and privileged operations belong in the Worker/KV/R2 side, not in frontend or DB rows.
- Keep auth-sensitive behavior auditable; avoid silent fallback paths for auth failures.

## Validation Expectations
- For function/auth changes, run relevant checks when available:
- `npm run test:auth-regression`
- `npm run check:gateway-only`
- `npm run test:gateway-shape`
- If behavior touches protected app routing or provider handling, also run:
- `npm run check:protected-apps`
- `npm run check:provider-strings`
