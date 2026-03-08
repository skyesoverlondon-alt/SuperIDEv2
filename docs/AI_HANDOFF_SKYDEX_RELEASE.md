# SkyDex Release Lane Handoff

Date: 2026-03-08

Completed in this pass:
- `netlify/functions/skyedrive-push.ts` now applies `buildSknoreReleasePlan(...)` before saving a SkyeDrive workspace snapshot.
- SkyeDrive push now rejects all-protected releases and returns `sknore` metadata with included and blocked counts plus blocked paths.
- `SkyDex4.6/index.html` now shows a SKNore release-truth panel with current blocked paths and the last release result.
- `SkyDex4.6/index.html` now has a SkyeBlog recall lane that can import recent blog records into the active workspace or reopen them in SkyeBlog through the existing bridge import flow.
- Public SkyDex was resynced through `npm run sync:skydex` and the repo built cleanly.

Validated:
- `npm run build`
- `npm run test:auth-regression`

Current release truth:
- GitHub push, Netlify deploy, and SkyeDrive push all now honor SKNore filtering.
- SkyDex computes a local preview of SKNore-blocked paths using the same glob semantics as the server helper.

Likely next upgrades:
- Add a dedicated server-side preview endpoint if SkyDex needs authoritative SKNore release previews without relying on the current client-side mirror logic.
- Expand blog recall into a richer cross-app return lane if the user wants post history, diffing, or direct reopen into SkyeChat or SkyeMail.
- Consider adding a small regression test around `skyedrive-push.ts` SKNore filtering if backend route fixtures are added.

Important user context:
- Do not try to commit large project zip artifacts into git again.
- User wants continued real architecture upgrades, not cosmetic cleanup.