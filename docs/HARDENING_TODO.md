# Skye Hardening Master TODO

This is the prioritized hardening backlog for production + enterprise distribution.

## P0 — Security & Access Control

- [ ] Enforce SKNore server-side in `kaixu-generate` (reject protected files even if client is bypassed).
- [ ] Add per-route scope checks for all privileged endpoints (`deploy`, `export`, `admin`).
- [ ] Rotate and document all secrets (`RUNNER_SHARED_SECRET`, `TOKEN_MASTER_SEQUENCE`, provider keys).
- [ ] Add automated secret scanning in CI (git leaks + high entropy checks).
- [ ] Add token replay protection and request nonce checks for sensitive APIs.
- [ ] Add org-level rate limiting and abuse throttling (IP + token + user dimensions).

## P0 — Data Protection

- [ ] Encrypt sensitive DB fields at rest (application-level encryption for high-risk metadata).
- [ ] Add retention/TTL policy for sessions, token history, and audit volume control.
- [ ] Add explicit data deletion workflows (user/org offboarding + right-to-delete tooling).
- [ ] Add backup verification runbook (restore drills with timestamped evidence).

## P0 — Reliability

- [ ] Add health probes for Netlify functions + Worker + Neon with status aggregation endpoint.
- [ ] Add retry/backoff wrappers for provider/network calls.
- [ ] Add circuit breaker behavior when external providers degrade.
- [ ] Add dependency failure fallback paths for AI gateway and email provider outages.

## P1 — Observability & Incident Response

- [ ] Add structured logs with request IDs across Netlify ↔ Worker hops.
- [ ] Add alerting thresholds (error rate, latency, auth failures, token misuse anomalies).
- [ ] Add incident severity matrix and escalation tree.
- [ ] Add postmortem template and evidence package format.

## P1 — QA, Tests, and Smoke

- [ ] Add endpoint contract tests for auth/token/email/chat flows.
- [ ] Add SKNore policy tests (glob matching, deny coverage, bypass attempts).
- [ ] Add token TTL tests (2m/1h/5h/day/week/month/quarter/year) and expiry assertions.
- [ ] Add scope enforcement tests for each privileged route.
- [ ] Add smoke status badge + historical dashboard export.

## P1 — Compliance & Trust

- [ ] Publish Security Overview + Architecture Decision Records (ADRs).
- [ ] Publish Data Processing & Retention policy.
- [ ] Publish Responsible AI use policy and model boundary statement.
- [ ] Add audit evidence integrity verification script for external auditors.

## P2 — Enterprise Device Rollout (Apple/HP/Channel)

- [ ] Build managed install packages and onboarding script for macOS + Windows.
- [ ] Add MDM deployment docs (Jamf/Intune profile baselines).
- [ ] Add hardware baseline matrix (CPU/RAM/storage/network by seat tier).
- [ ] Add offline/low-bandwidth behavior and caching profile docs.
- [ ] Add procurement-ready one-pager with security, support, SLA and rollout milestones.

## P2 — Commercial Readiness

- [ ] Define support SLAs (P1/P2/P3 response/resolution targets).
- [ ] Define release channels (stable/candidate/canary) and rollback policy.
- [ ] Define version compatibility and long-term support windows.
- [ ] Define enterprise onboarding checklist and success criteria.
