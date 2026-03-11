# SKYE-10 — Handoff Protocol

## Objective
Force continuous AI succession so work continues from repo state instead of chat memory.

## Required Reads
1. `docs/AI_HANDOFF_SKYDEX_RELEASE.md`
2. `DEVV ONLY NO GIT/Round2 Execution Board.md`
3. `docs/skye/manifest.json`
4. `docs/skye/NEXT_ACTION.md`
5. `docs/skye/WORKLOG.md`

## Target Files
- `docs/skye/manifest.json`
- `docs/skye/NEXT_ACTION.md`
- `docs/skye/WORKLOG.md`

## Edit Directives
- Every future pass must:
  1. read `docs/skye/NEXT_ACTION.md`
  2. execute one stage or dependency-safe subtask
  3. update `docs/skye/manifest.json`
  4. append to `docs/skye/WORKLOG.md`
  5. rewrite `docs/skye/NEXT_ACTION.md`
- If blocked:
  - mark the stage `blocked`
  - state the blocker explicitly
  - name the blocking file or dependency
  - only jump to another stage if dependency-safe
- If done:
  - mark the stage `done`
  - activate the next dependency-ready stage
  - define the next exact starting file and validation command
- Never rely on prior chat as the handoff system.

## Validation
- A future agent can resume from files only.
- `NEXT_ACTION.md` always points to one exact starting move.
- `manifest.json` and `WORKLOG.md` match each other.

## Exit Criteria
- Succession protocol is clear and enforceable.
- No stage completion can happen silently.
- Repo state alone is enough for continuation.

## Known Blockers
- None if the control files remain maintained.

## Next Stage
Completion stage. Keep updating this protocol as the rollout evolves.

## Recorded Outcome
- This pass updated `docs/skye/manifest.json`, `docs/skye/NEXT_ACTION.md`, and `docs/skye/WORKLOG.md` after every stage-safe change, so repo state remains the source of truth.
- The previously unresolved blocker was cleared explicitly: `SKYE-05` is now complete after the protected DocxPro manifest pin was intentionally repointed to the audited migrated artifact.
- `NEXT_ACTION.md` now points to maintenance-only release evidence refresh instead of a rollout blocker.

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `docs/skye/manifest.json` | created | keep stage state current | none | state review | done | machine-readable truth updated with blocked and completed stage states |
| `docs/skye/NEXT_ACTION.md` | created | keep next action concrete and singular | none | restart review | done | first file every future pass reads |
| `docs/skye/WORKLOG.md` | created | append-only updates after every pass | none | chronology review | done | chronology preserved with newest entries at top |
