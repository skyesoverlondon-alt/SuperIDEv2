# SKNore Architecture

SKNore is a deny-list policy layer that prevents protected files from being included in AI generation payloads or export surfaces.

## Purpose

- Let users mark file paths/globs as AI off-limits.
- Ensure protected files are never sent to model APIs.
- Provide auditable and user-controlled policy behavior.

## Policy Model

- Input: glob-like patterns, one per line.
- Examples:
  - `.env`
  - `.env.*`
  - `secrets/**`
  - `**/*.pem`
  - `**/*.key`

## Runtime Wiring (Current)

- Frontend policy parser/filter: `src/sknore/policy.ts`
- Frontend persistence key: `kx.sknore.patterns`
- AI request gate: `src/App.tsx` (`runGenerate` and smoke generate body)

## Enforcement Rules

1. Protected active file cannot be used for AI generate calls.
2. Protected files are removed from `files` payload before `/api/kaixu-generate`.
3. Smoke generate checks use filtered file payloads as well.

## Next Hardening Steps

- Mirror SKNore checks server-side in Netlify function to prevent client bypass.
- Add org-level SKNore policy in database (`org_settings` or dedicated table).
- Emit SKNore audit events for blocked attempts.
