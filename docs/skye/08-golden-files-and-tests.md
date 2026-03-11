# SKYE-08 — Golden Files And Validation Tests

## Objective
Upgrade `.skye` validation from plaintext schema checks to real secure-envelope contract testing.

## Required Reads
1. `docs/skye/02-contract-spec.md`
2. `docs/skye-schema-fixture.json`
3. `docs/export-import-fixtures.json`
4. `scripts/check-skye-schema.js`
5. `scripts/test-export-import-schema.js`

## Target Files
- `scripts/check-skye-schema.js`
- `scripts/test-export-import-schema.js`
- `docs/skye-schema-fixture.json`
- `docs/export-import-fixtures.json`
- new golden-file directory under `docs/skye/`

## Edit Directives
- Define real envelope-level coverage for:
  - valid marker
  - invalid marker rejection
  - delimiter validation
  - malformed JSON rejection
  - wrong `format` rejection
  - wrong `alg` rejection
  - wrong `kdf` rejection
  - wrong `iterations` rejection
  - decrypt success
  - wrong passphrase rejection
  - tamper rejection
  - wrong-app compatibility handling
- Add golden-file planning for:
  - valid secure envelope
  - tampered secure envelope
  - legacy readable example
  - wrong-app example
- Keep tests deterministic and release-friendly.

## Validation
- Test plan covers envelope-level behavior.
- Fixture gaps are documented.
- Golden-file location and naming rules exist.

## Exit Criteria
- Tests no longer only validate plaintext payload shape.
- Golden files are planned or created.
- Release-gate integration inputs are ready for `SKYE-09`.

## Known Blockers
- Shared runtime implementation may be needed to generate canonical fixtures.

## Next Stage
`SKYE-09`

## Recorded Outcome
- `scripts/check-skye-schema.js` now validates the canonical secure contract fields against the shared runtime constants instead of only checking plaintext shape.
- `scripts/test-export-import-schema.js` now exercises real secure-envelope behavior: marker and delimiter rejection, malformed JSON rejection, metadata rejection, decrypt success, wrong-passphrase failure, tamper rejection, wrong-app compatibility rejection, and audited legacy adapters.
- `docs/skye-schema-fixture.json` now stores the canonical contract header plus canonical plaintext samples.
- `docs/export-import-fixtures.json` now stores the runtime test fixture, vector matrix, wrong-app fixture, and golden-file planning metadata.
- `docs/skye/fixtures/manifest.json` now defines the durable golden-file naming and coverage manifest for runtime-generated `.skye` artifacts.
- Validation passed with `npm run check:skye-schema` and `npm run test:export-import-schema`.

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `scripts/check-skye-schema.js` | current plaintext-shape validation | expand to envelope contract validation | SKYE-02 | test coverage review | done | validates canonical contract constants and golden manifest coverage |
| `scripts/test-export-import-schema.js` | current limited schema testing | expand to import/export behavior tests | SKYE-02 | test coverage review | done | covers secure roundtrip, tamper rejection, passphrase enforcement, and legacy adapters |
| `docs/skye-schema-fixture.json` | single fixture | align with canonical payload spec | SKYE-02 | fixture review | done | now stores contract metadata plus canonical payload samples |
| `docs/export-import-fixtures.json` | fixture set exists | classify what new vectors are missing | SKYE-02 | fixture review | done | now stores runtime fixture, vector matrix, and golden planning metadata |
| `docs/skye/fixtures/` | not yet created | hold real `.skye` golden files | SKYE-03 | file naming and coverage plan | done | manifest created; binary artifacts remain runtime-generated to avoid unstable ciphertext churn |
