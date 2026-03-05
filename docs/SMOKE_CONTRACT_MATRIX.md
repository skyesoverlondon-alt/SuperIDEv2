# Smoke Contract Matrix

Date: 2026-03-05
Scope: SuperIDEv2 Round 2 quality gates

## Contract Types

- `blocking`: must pass for release lane progression
- `non-blocking`: advisory; track and remediate

## Matrix

| Contract | Scope | Type | Tool/Path | Pass Criteria |
|---|---|---|---|---|
| Surface Reachability | Core app surfaces | blocking | `scripts/smokehouse.sh` | All core surfaces return 2xx |
| Worker Health | Worker endpoint | blocking | `scripts/smokehouse.sh` | 2xx or policy-protected 302/401/403 |
| Gateway Generate | `/api/kaixu-generate` | blocking | `scripts/smokehouse.sh` | Valid response or expected auth protection |
| Auth Introspection | `/api/auth-me` | blocking | `scripts/smokehouse.sh` | Valid response or expected auth protection |
| Gateway-Only Policy | Gateway surfaces | blocking | `scripts/check-gateway-only.js` | No direct provider pattern violations |
| Secure Defaults | Headers/auth defaults | blocking | `scripts/check-secure-defaults.js` | Required secure snippets present |
| Build Integrity | Frontend bundle | blocking | `npm run build` | Vite build exits 0 |
| Schema Validation | `.skye` envelopes | blocking | `scripts/check-skye-schema.js` | All sampled envelopes valid |
| Token UX Misuse States | Shell UX | non-blocking | Manual + UI | Misuse states surfaced clearly |
| Health Snapshot Export | Shell support flow | non-blocking | Manual export | JSON export succeeds with redaction |

## Execution Order

1. `npm run check:gateway-only`
2. `npm run check:secure-defaults`
3. `npm run check:skye-schema`
4. `npm run build`
5. `bash scripts/smokehouse.sh <site> <worker>`
6. `npm run release:checklist`

## Release Gate Rule

- Any failing `blocking` contract = release blocked.
- No commit/push for release lane until all blocking contracts pass.
