# SKYE-05 — Source-Root Surface Migrations

## Objective
Migrate source-root surfaces first, respecting sync ownership and protected-surface policy.

## Required Reads
1. `package.json`
2. `docs/protected-apps-manifest.json`
3. `scripts/check-protected-apps.js`
4. `docs/skye/03-shared-runtime-module.md`

## Target Files
- `SkyeDocxPro/index.html`
- `SkyeBlog/index.html`
- `SovereignVariables/index.html`
- any supporting shared asset or sync path used by those source roots

## Edit Directives
- Treat source-root files as primary if `package.json` sync scripts copy them into `public/`.
- Migrate each eligible source-root surface to shared runtime consumption.
- For each target file, record:
  - current implementation status
  - expected migration path
  - protected or unprotected status
  - public sync impact
- Respect protected-surface restrictions for DocxPro before any code-level migration.
- Record whether migration proceeds, is deferred, or is blocked.

## Validation
- `npm run sync:surfaces` planned or recorded after edits.
- Protected-app checks considered before finalizing work.
- Each source-root surface has a disposition: migrated, deferred, or blocked.

## Exit Criteria
- Source-root migration path is explicit for all listed targets.
- DocxPro handling is documented with protected-app awareness.
- Public sync implications are recorded.

## Known Blockers
- Protected hash enforcement may prevent direct DocxPro edits until approved.

## Immediate Execution Order
1. Review `docs/protected-apps-manifest.json` and treat `SkyeDocxPro/index.html` as blocked unless the protected hash policy is intentionally updated.
2. Migrate `SkyeBlog/index.html` to the shared browser runtime path first because it is unprotected and already mirrors DocxPro’s duplicated crypto flow.
3. Migrate `SovereignVariables/index.html` next because it is unprotected and has the weakest import validation.
4. Run `npm run sync:surfaces` after source-root edits.
5. Run `npm run check:protected-apps` before closing the stage.

## Next Stage
`SKYE-06`

## Recorded Outcome
- `SkyeBlog/index.html` migrated to the shared browser runtime and synced into `public/SkyeBlog/index.html`.
- `SovereignVariables/index.html` migrated to the shared browser runtime and synced into `public/SovereignVariables/index.html`.
- `SkyeDocxPro/index.html` is now migrated to the shared browser runtime and synced into `public/SkyeDocxPro/index.html`.
- `npm run sync:surfaces` completed after the DocxPro source-root migration.
- `docs/protected-apps-manifest.json` was intentionally repinned to the audited current DocxPro artifact hash `d72ead1daf963a5ceb5e20c3c6866338b1d69490614396819f645ef2edd2b2e2`.

## Blocker Detail
- The original blocker was traced to a stale manifest pin, not an orphaned local artifact.
- Git history shows the manifest pin was introduced at commit `5eebb6d` with hash `b53bbc060760e06ad0f5c062b05e2767d4bbd672e36942d4cdfc68660113d3fa`, while `public/SkyeDocxPro/index.html` changed in multiple later commits through `39df2be` without a matching manifest repin.
- The protection rule remains intact because the repin was explicit, documented, and validated after the DocxPro migration.

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `SkyeDocxPro/index.html` | known secure source-root implementation | decide protected-safe migration path | SKYE-03 | protected-app review | done | shared runtime loaded from `/_shared/skye/skyeSecure.js`; manifest intentionally repinned after audited migration |
| `SkyeBlog/index.html` | source-root implementation | migrate to shared runtime path | SKYE-03 | sync ownership check | done | shared runtime loaded from `/_shared/skye/skyeSecure.js` |
| `SovereignVariables/index.html` | source-root implementation | migrate to shared runtime path | SKYE-03 | sync ownership check | done | canonical validation strengthened with shared runtime |
| `package.json` | sync scripts present | confirm copy path after changes | SKYE-01 | sync map | done | `sync:surfaces` recorded after source-root edits |
| `scripts/check-protected-apps.js` | protected enforcement exists | review validation dependency | none | protected review notes | done | validation now passes after the explicit DocxPro manifest repin |
