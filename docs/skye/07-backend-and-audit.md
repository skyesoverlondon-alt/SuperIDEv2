# SKYE-07 — Backend And Audit Alignment

## Objective
Define how imported `.skye` state persists and how export/import events become auditable without weakening tenancy or response contracts.

## Required Reads
1. `.github/instructions/netlify-functions.instructions.md`
2. `netlify/functions/app-record-save.ts`
3. `netlify/functions/app-record-list.ts`
4. `db/schema.sql`

## Target Files
- `netlify/functions/app-record-save.ts`
- `netlify/functions/app-record-list.ts`
- `db/schema.sql`
- related shared auth or response helpers only if strictly required

## Edit Directives
- Audit whether current app-record whitelists block intended `.skye` ecosystem rollout.
- Decide whether the rollout should:
  - extend existing app-record routes,
  - add app-specific import/export endpoints,
  - add schema-version migration support,
  - add export/import audit records.
- Preserve org/workspace tenancy rules.
- Preserve explicit error-shape conventions.
- Do not place secrets or passphrases in backend payloads or storage.

## Validation
- Persistence approach is documented.
- Audit expectations are documented.
- Whitelist or schema gaps are identified.

## Exit Criteria
- Backend path for imported data is explicit.
- Audit path is explicit.
- Netlify guardrails are referenced and preserved.

## Known Blockers
- Existing schemas may support the data already but require mapping decisions.

## Next Stage
`SKYE-08`

## Persistence Decision
- Do not store encrypted `.skye` envelopes, passphrases, or hints in backend rows.
- Persist only decrypted canonical app state through `app_records` when a surface chooses to sync imported state back to the workspace.
- Reuse the existing whitelist-based `app-record-save` and `app-record-list` path rather than adding app-specific `.skye` endpoints during this stage.
- Extend whitelist coverage only where rollout surfaces need first-class workspace persistence.

## Audit Decision
- Continue using `audit()` from `app-record-save.ts` for explicit workspace persistence events.
- Continue using `emitSovereignEvent()` from `app-record-save.ts` so import-driven saves remain visible in `sovereign_events` and downstream timelines.
- Keep audit payloads limited to app, record, idempotency, correlation, and operation metadata; never send passphrases or ciphertext to the backend.

## Recorded Outcome
- `netlify/functions/app-record-save.ts` and `netlify/functions/app-record-list.ts` now share one allowlist helper under `netlify/functions/_shared/app-records.ts`.
- Allowlist coverage now explicitly includes `SkyeMail`, `SkyeChat`, and `SovereignVariables` so the `.skye` rollout is not blocked from persisting canonical imported state through the existing workspace record path.
- `db/schema.sql` now documents that only decrypted canonical state belongs in `app_records`, while audit visibility remains in `audit_events` and `sovereign_events`.

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `netlify/functions/app-record-save.ts` | current whitelist-based persistence | assess `.skye` rollout fit and gaps | SKYE-02 | persistence review | done | shared allowlist now covers rollout surfaces without changing tenancy or error shape |
| `netlify/functions/app-record-list.ts` | current whitelist-based listing | assess app coverage gaps | SKYE-02 | coverage review | done | read path matches save path coverage via shared helper |
| `db/schema.sql` | broad schema exists | map storage and audit expectations | SKYE-02 | schema mapping notes | done | documented that encrypted envelopes and secrets are out of scope for DB storage |
