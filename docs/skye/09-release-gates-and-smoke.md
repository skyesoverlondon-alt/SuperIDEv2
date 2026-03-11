# SKYE-09 — Release Gates And Smoke Integration

## Objective
Make `.skye` validation visible in release gates and smoke documentation.

## Required Reads
1. `docs/SMOKE_CONTRACT_MATRIX.md`
2. `scripts/run-release-checklist.js`
3. `scripts/smokehouse.sh`
4. `docs/skye/08-golden-files-and-tests.md`

## Target Files
- `scripts/run-release-checklist.js`
- `scripts/smokehouse.sh`
- `docs/SMOKE_CONTRACT_MATRIX.md`
- `artifacts/release-gates.json`

## Edit Directives
- Add `.skye` contract checks to release checklist planning.
- Add smoke visibility for export/import checks where feasible.
- Record exact gate statements for:
  - canonical contract validity
  - secure roundtrip retention
  - tamper rejection
  - passphrase enforcement
- Keep release outputs explicit and machine-readable.

## Validation
- `.skye` is represented in release gate planning.
- Smoke documentation references the same validation model.
- Gate language is concrete, not aspirational.

## Exit Criteria
- Release checklist plan includes `.skye`.
- Smoke references are aligned with release checks.
- Downstream artifact expectations are written.

## Known Blockers
- Real smoke automation may need later implementation support rather than docs alone.

## Next Stage
`SKYE-10`

## Recorded Outcome
- `scripts/run-release-checklist.js` now emits explicit `area` and `contract` metadata for every release check, including `.skye` contract validity and secure roundtrip/tamper/passphrase enforcement.
- `scripts/smokehouse.sh` now prints the `.skye` gate references so smoke output points operators back to the release-visible contract checks without pretending HTTP smoke can validate encrypted roundtrips by itself.
- `docs/SMOKE_CONTRACT_MATRIX.md` now names the four `.skye` release-visible contracts explicitly: canonical contract validity, secure roundtrip retention, tamper rejection, and passphrase enforcement.
- `artifacts/release-gates.json` already classified `.skye` checks under `data_integrity`, so no hand edit was required for the generated artifact during this stage.
- Validation passed with `npm run check:skye-schema`, `npm run test:export-import-schema`, and `bash -n scripts/smokehouse.sh`.

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `scripts/run-release-checklist.js` | release checklist runner exists | add `.skye` gate plan | SKYE-08 | checklist review | done | machine-readable `area` and `contract` fields now expose `.skye` gate meaning |
| `scripts/smokehouse.sh` | smoke runner exists | add `.skye` smoke references if feasible | SKYE-08 | smoke review | done | smoke output now references the release-visible `.skye` validation path |
| `docs/SMOKE_CONTRACT_MATRIX.md` | smoke contract matrix exists | align matrix with `.skye` checks | SKYE-08 | matrix review | done | matrix now states the `.skye` contract gates concretely |
| `artifacts/release-gates.json` | release artifact exists | define future `.skye` gate outputs | SKYE-08 | artifact field notes | done | existing generated gate taxonomy already includes `.skye` under `data_integrity`; regenerate later via scripts if needed |
