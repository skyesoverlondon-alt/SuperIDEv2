# .SKYE Execution Master Index

## Purpose
This directory turns the policy brief in `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files` into an execution system that can be resumed by later AI passes without rereading chat history.

## Mission
`.skye` is the company-owned secure file type for portable app state, encrypted handoff, offline resilience, and cross-app continuity. All rollout work in this directory must protect that contract while converging the repo on one secure write format and controlled legacy read behavior.

## Repo Architecture Context
SuperIDEv2 is a split-runtime system:
- `src/` contains the React/Vite shell and orchestration layer.
- `public/` contains standalone app and platform surfaces.
- `netlify/functions/` contains the tenancy-aware API layer.
- `worker/src/` contains privileged runtime operations.
- `db/schema.sql` defines persistence primitives.
- `scripts/` and `docs/` define release gates, smoke, and policy validation.

## Current Reality
The current `.skye` baseline in the source directive is stale. More than two implementations exist, crypto behavior is duplicated, and source ownership is split across source-root surfaces and `public/` copies. Stage 01 must correct the baseline before any migration work proceeds.

## Required Reads Before Editing
1. `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files`
2. `DEVV ONLY NO GIT/What This Is`
3. `package.json`
4. `docs/SMOKE_CONTRACT_MATRIX.md`
5. `docs/protected-apps-manifest.json`
6. `.github/instructions/netlify-functions.instructions.md` when editing `netlify/functions/**`
7. `.github/instructions/worker-runtime.instructions.md` when editing `worker/**`

## Ordered Stages
1. `SKYE-01` — baseline audit
2. `SKYE-02` — canonical contract spec
3. `SKYE-03` — shared runtime extraction plan
4. `SKYE-04` — SuperIDE shell migration
5. `SKYE-05` — source-root surface migrations
6. `SKYE-06` — direct-public platform migrations
7. `SKYE-07` — backend and audit alignment
8. `SKYE-08` — golden files and validation tests
9. `SKYE-09` — release gates and smoke integration
10. `SKYE-10` — handoff protocol and continuous succession

## Execution Rules
- Do not skip dependency order.
- Do not edit synced `public/` copies when a source-root file is the true owner.
- Do not alter protected surfaces without first checking `docs/protected-apps-manifest.json` and `scripts/check-protected-apps.js`.
- Do not weaken auth, tenancy, worker verification, or security defaults during `.skye` rollout.
- Prefer additive docs and explicit migration notes over silent assumptions.

## Update Rules For Every Future Pass
1. Read `docs/skye/NEXT_ACTION.md` first.
2. Complete one stage or one dependency-safe subtask.
3. Update `docs/skye/manifest.json`.
4. Append an entry to `docs/skye/WORKLOG.md`.
5. Rewrite `docs/skye/NEXT_ACTION.md` with the next exact action.

## Completion Standard
The `.skye` rollout is not complete until:
- one canonical secure write contract is enforced,
- legacy-read behavior is explicitly scoped,
- duplicated crypto logic is centralized,
- target surfaces are migrated or formally blocked,
- backend and audit expectations are documented,
- envelope-level validation exists,
- release gates include `.skye`, and
- this directory can drive continued execution without chat history.
