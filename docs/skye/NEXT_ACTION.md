# Next Action

- Active stage: `SKYE-10` (maintenance)
- Open first: `artifacts/release-checklist.json`
- Then work these files in order:
  1. `docs/skye/manifest.json`
  2. `docs/skye/WORKLOG.md`
  3. `docs/skye/NEXT_ACTION.md`
- Required output for completion:
  - keep the rollout handoff state aligned with the latest release validation evidence
  - if new `.skye` work begins later, add it through a new explicit stage or dependency-safe maintenance note
  - do not treat future non-`.skye` release-checklist drift as a `.skye` regression unless the secure envelope, protected-app manifest, or release gate contract actually changes
- Validation after work:
  - run `npm run release:checklist` when release evidence needs refresh
  - update `docs/skye/manifest.json` only if a new blocker or maintenance task appears
  - append to `docs/skye/WORKLOG.md`
- All staged `.skye` rollout work is complete, including the protected DocxPro migration and explicit manifest repin.
- Latest validation status: `artifacts/release-checklist.json` is green after the non-`.skye` policy fixes.
- Most recent maintenance fixes that cleared release drift:
  - `public/_shared/kaixu-provider-bridge.js`
  - `public/REACT2HTML/index.html`
  - `public/SkyeTasks/index.html`
- Next stage if successful: maintenance only
