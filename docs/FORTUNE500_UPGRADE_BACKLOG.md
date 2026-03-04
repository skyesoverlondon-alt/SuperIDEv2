# Fortune-500 Upgrade Backlog

This backlog converts the current MVP posture into enterprise-grade delivery while preserving the existing architecture:

- Frontend (Vite/React) -> Netlify Functions (policy/auth/audit) -> Cloudflare Worker (privileged execution) -> Neon + KV + R2.

## Phase 1 (Now) — Mail/Chat Production Data Plane

- [x] Add persisted SkyeMail history endpoint.
- [x] Add persisted SkyeChat history endpoint.
- [x] Add cursor pagination + filters/search for both history endpoints.
- [x] Add query indexes for large-history reads.
- [x] Add UI refresh/load-more/filter controls backed by persisted APIs.
- [ ] Add endpoint contract tests for history APIs.

## Phase 2 — Security & Policy Enforcement

- [ ] Mirror SKNore policy checks server-side in `kaixu-generate`.
- [ ] Add per-route scope enforcement for all privileged operations.
- [ ] Add request correlation IDs and structured logs across Netlify -> Worker.
- [ ] Add org/user/token scoped rate limits and replay prevention for sensitive calls.
- [ ] Add admin audit trail queries + export verification tooling.

## Phase 3 — Reliability & Observability

- [ ] Add provider retry/backoff wrappers with timeout budgets.
- [ ] Add circuit breakers for gateway/mail/deploy external dependencies.
- [ ] Add status aggregation endpoint (frontend + functions + worker + db dependencies).
- [ ] Add alert conditions for auth failures, token abuse, latency spikes, and error ratio.

## Phase 4 — Data Governance & Compliance

- [ ] Define retention policies for sessions, audit, app records, and token metadata.
- [ ] Add operational deletion workflows for org/user offboarding.
- [ ] Add backup restore drills and evidence capture runbook.
- [ ] Publish security architecture + data processing and retention docs.

## Phase 5 — App Suite Completion

- [ ] Replace remaining local-only app modules with persisted API-backed models.
- [ ] Add role-aware access patterns (owner/admin/member/viewer) across all Skye app routes.
- [ ] Add full QA matrix: unit, contract, integration, smoke, and regression suites.
- [ ] Add release channel controls (stable/candidate/canary) and rollback playbooks.

## Non-Negotiable Constraints

- Keep current architecture boundaries unchanged.
- Do not move privileged operations into the browser.
- Keep secrets server-side only.
- Preserve org/workspace tenancy checks on all data-bearing routes.
