# SKYE-06 — Direct-Public Platform Migrations

## Objective
Plan and execute `.skye` migration for direct-public surfaces while clearly distinguishing platforms from standalone apps.

## Required Reads
1. `docs/skye/01-baseline-audit.md`
2. `docs/skye/03-shared-runtime-module.md`
3. `DEVV ONLY NO GIT/What This Is`

## Target Files
- `public/SkyeMail/index.html`
- `public/SkyeChat/index.html`
- any additional direct-public surfaces discovered to contain `.skye` import/export logic

## Edit Directives
- Classify direct-public targets into:
  - platform surfaces
  - suite mega-apps
  - simple standalone apps
- For each target, define:
  - `meta.app_id`
  - import compatibility scope
  - asset expectations
  - export/import entry points in the UI
- Migrate direct-public targets to shared runtime consumption when implementation begins.
- Keep layout and platform identity intact; `.skye` convergence must not flatten the product surface.

## Validation
- Each direct-public target has a class and migration rule.
- Shared runtime consumption path is documented for browser-only surfaces.
- Any additional discovered targets are appended to this stage.

## Exit Criteria
- Direct-public surfaces have explicit migration rules.
- Platform-class surfaces are clearly identified.
- UI entry point consistency expectations are written.

## Known Blockers
- Additional direct-public implementations may surface during later discovery.

## Next Stage
`SKYE-07`

## Platform Classification
- `public/SkyeMail/index.html` is a platform-class communications surface. Its `.skye` entry points are `Export .skye` and `Import .skye`, with `meta.app_id = SkyeMail`, no binary asset expectation, and compatibility limited to canonical payloads plus legacy app-local payloads carrying `state.inbox_records`.
- `public/SkyeChat/index.html` is a platform-class communications surface. Its `.skye` entry points are `Export .skye` and `Import .skye`, with `meta.app_id = SkyeChat`, no binary asset expectation, and compatibility limited to canonical payloads plus legacy app-local payloads carrying `state.feed_records`.
- Additional direct-public `.skye` surfaces were not discovered during this pass.

## Recorded Outcome
- `public/SkyeMail/index.html` now consumes `/_shared/skye/skyeSecure.js` instead of maintaining duplicated crypto helpers.
- `public/SkyeChat/index.html` now consumes `/_shared/skye/skyeSecure.js` instead of maintaining duplicated crypto helpers.
- Both surfaces now use the shared runtime for envelope serialization, envelope reads, encryption, decryption, and canonical payload validation while preserving their existing merge-or-replace UX.

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `public/SkyeMail/index.html` | known direct-public implementation | migrate to shared runtime path | SKYE-03 | platform classification review | done | platform-class surface; canonical payload validation added |
| `public/SkyeChat/index.html` | known direct-public implementation | migrate to shared runtime path | SKYE-03 | platform classification review | done | platform-class surface; canonical payload validation added |
| additional direct-public surfaces | unknown until discovered | append and classify if found | SKYE-01 | inventory update | done | no additional direct-public `.skye` targets found in this pass |
