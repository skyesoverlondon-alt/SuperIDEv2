# SKYE-04 — SuperIDE Shell Migration

## Objective
Migrate the React shell to the shared `.skye` runtime and make the shell the first canonical implementation.

## Required Reads
1. `docs/skye/03-shared-runtime-module.md`
2. `src/App.tsx`
3. `src/lib/providers/workspaceFileProvider.ts`

## Target Files
- `src/App.tsx`
- new shared `.skye` module under `src/lib/`
- supporting provider files only if required by shell import/export behavior

## Edit Directives
- Replace inline `.skye` export/import logic in `src/App.tsx` with calls to the shared runtime.
- Preserve current shell workspace semantics.
- Normalize payload generation to canonical `meta + state + assets`.
- Make `schema_version` explicit.
- Make `meta.app_id` compatibility rules explicit.
- Retain legacy-read support only if allowed by `SKYE-02`.
- Do not broaden scope into unrelated shell refactors.

## Validation
- Shell uses shared runtime symbols.
- Shell can write canonical secure envelope.
- Shell read path follows contract validation rules.

## Exit Criteria
- `src/App.tsx` no longer defines unique crypto rules.
- Shell is the first migrated canonical implementation.
- No unrelated shell regressions are introduced.

## Known Blockers
- Shared runtime implementation must exist first.

## Stage Outcome
Complete. `src/App.tsx` now imports the shared `.skye` runtime, writes canonical `meta + state + assets` plaintext payloads through the shared serializer, reads canonical secure envelopes through the shared reader, and retains migration-only compatibility for legacy shell secure snapshots and `skye-v2` JSON imports.

## Next Stage
`SKYE-05`

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/App.tsx` | shell export/import now uses shared runtime | keep migration adapters narrow and canonical payload stable | SKYE-03 | shell export/import review | done | primary migration target completed |
| `src/lib/providers/workspaceFileProvider.ts` | shell file provider | no change required in this stage | SKYE-03 | provider regression review | done | kept minimal as directed |
| `src/lib/*` shared module | runtime landed under `src/lib/skye/` | maintain shared contract surface for later migrations | SKYE-03 | types and helpers compile | done | shell now depends on shared module |
