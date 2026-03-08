# SkyDex Release Lane Handoff

Date: 2026-03-08

Completed in this pass:
- `netlify/functions/skyedrive-push.ts` now applies `buildSknoreReleasePlan(...)` before saving a SkyeDrive workspace snapshot.
- SkyeDrive push now rejects all-protected releases and returns `sknore` metadata with included and blocked counts plus blocked paths.
- `SkyDex4.6/index.html` now shows a SKNore release-truth panel with current blocked paths and the last release result.
- `SkyDex4.6/index.html` now has a SkyeBlog recall lane that can import recent blog records into the active workspace or reopen them in SkyeBlog through the existing bridge import flow.
- Public SkyDex was resynced through `npm run sync:skydex` and the repo built cleanly.

Completed in the follow-up pass:
- Added `netlify/functions/sknore-release-preview.ts` so SkyDex can ask the server for an authoritative SKNore release preview against the current file snapshot.
- `SkyDex4.6/index.html` now debounces preview requests to `/api/sknore-release-preview` instead of mirroring SKNore logic in the browser.
- SkyDex blog recall can now route the selected SkyeBlog record directly to SkyeChat or SkyeMail.
- Restored `consumeBridgeDraft()` in `SkyeBlog/index.html` so SkyDex recall can still reopen drafts in SkyeBlog after surface sync.

Validated:
- `npm run build`
- `npm run test:auth-regression`
- `npm run build` after restoring the SkyeBlog source bridge-import handler

Current release truth:
- GitHub push, Netlify deploy, and SkyeDrive push all now honor SKNore filtering.
- SkyDex now asks the server for SKNore preview counts and blocked paths, including the current editor state when unsaved files exist.

Likely next upgrades:
- Expand blog recall into a richer cross-app return lane if the user wants post history, diffing, or direct reopen into SkyeChat or SkyeMail.
- Consider adding a small regression test around `skyedrive-push.ts` SKNore filtering if backend route fixtures are added.

Important user context:
- Do not try to commit large project zip artifacts into git again.
- User wants continued real architecture upgrades, not cosmetic cleanup.