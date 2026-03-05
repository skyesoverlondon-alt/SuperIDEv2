# Round 2 Execution Board

Source: `DEVV ONLY NO GIT/Needed Upgrades `
Date started: 2026-03-05

Status legend:
- `todo`
- `in-progress`
- `done`
- `blocked`

## 1) Global Platform Hardening

- [x] `R2-001` Define uptime and latency SLO targets per app class.
- [x] `R2-002` Add shared retry/backoff utility for gateway calls in all standalone apps.
- [x] `R2-003` Add idempotency keys for write-heavy workflows.
- [x] `R2-004` Add cross-app fail-safe mode banner when dependencies degrade.
- [x] `R2-005` Add unified client telemetry envelope.
- [x] `R2-006` Add frontend error fingerprinting with reporting IDs.
- [x] `R2-007` Add correlation IDs from UI to Netlify logs.
- [x] `R2-008` Add per-app health snapshot export.
- [x] `R2-009` Enforce gateway-only AI call path validation in CI.
- [x] `R2-010` Add token misuse detection states.
- [x] `R2-011` Add sensitive field redaction policy for diagnostics exports.
- [x] `R2-012` Add secure defaults check script.
- [x] `R2-013` Add smoke contract matrix file.
- [x] `R2-014` Add policy gate for forbidden provider strings.
- [x] `R2-015` Add schema version validator for `.skye` imports.
- [x] `R2-016` Add release checklist runner emitting JSON artifact.

## 2) SuperIDE Shell

- [ ] `R2-017` Add release cockpit with live gate status per app.
- [ ] `R2-018` Add app readiness score.
- [ ] `R2-019` Add workspace dependency status panel.
- [ ] `R2-020` Add one-click Run App Proof flow.
- [ ] `R2-021` Add signed build metadata block in shell footer.
- [ ] `R2-022` Add keyboard command palette for app quick actions.

## 3) Standalone App Targets

- [ ] `R2-023` SkyeBookx: chapter consistency analyzer.
- [ ] `R2-024` SkyeBookx: scene card navigator with reorder.
- [ ] `R2-025` SkyeBookx: manuscript export pack.
- [ ] `R2-026` SkyeBookx: oversized cloud payload recovery mode.

- [ ] `R2-027` SkyePlatinum: directive workflow states.
- [ ] `R2-028` SkyePlatinum: financial anomaly trend panel.
- [ ] `R2-029` SkyePlatinum: executive report export.
- [ ] `R2-030` SkyePlatinum: role-based action lock.

- [ ] `R2-031` SkyeCalendar: drag-and-drop scheduling.
- [ ] `R2-032` SkyeCalendar: dependency chain timeline.
- [ ] `R2-033` SkyeCalendar: workload heatmap.
- [ ] `R2-034` SkyeCalendar: reminder delivery audit trail.

- [ ] `R2-035` SkyeTasks: dependency graph view.
- [ ] `R2-036` SkyeTasks: SLA breach routing templates.
- [ ] `R2-037` SkyeTasks: workload balancing suggestions.
- [ ] `R2-038` SkyeTasks: completion quality templates.

- [ ] `R2-039` SkyeMail: send policy preflight.
- [ ] `R2-040` SkyeMail: delivery queue monitor retry controls.
- [ ] `R2-041` SkyeMail: template library with approval tags.
- [ ] `R2-042` SkyeMail: outbound audit export with correlation IDs.

- [ ] `R2-043` SkyeChat: decision extraction to Tasks/Calendar.
- [ ] `R2-044` SkyeChat: moderation timeline with reversible actions.
- [ ] `R2-045` SkyeChat: channel quality signals.
- [ ] `R2-046` SkyeChat: digest export schema.

- [ ] `R2-047` SKNore: policy compiler severity tiers.
- [ ] `R2-048` SKNore: rule overlap visualization/risk scoring.
- [ ] `R2-049` SKNore: policy test suite presets.
- [ ] `R2-050` SKNore: policy pack signing and verification.

- [ ] `R2-051` Neural Space Pro: multi-stage run pipeline.
- [ ] `R2-052` Neural Space Pro: checkpoint restore with replay notes.
- [ ] `R2-053` Neural Space Pro: context budget inspector/citation confidence.
- [ ] `R2-054` Neural Space Pro: direct publish bridges + receipts.

- [ ] `R2-055` SkyeDrive: immutable artifact mode.
- [ ] `R2-056` SkyeDrive: share-link governance controls.
- [ ] `R2-057` SkyeDrive: integrity verify-on-open.
- [ ] `R2-058` SkyeDrive: storage pressure predictor/cleanup assistant.

- [ ] `R2-059` SkyeVault: secret access approval workflow.
- [ ] `R2-060` SkyeVault: usage attestation logging.
- [ ] `R2-061` SkyeVault: rotation playbooks by scope profile.
- [ ] `R2-062` SkyeVault: break-glass session auditing.

- [ ] `R2-063` SkyeForms: response workflow routing.
- [ ] `R2-064` SkyeForms: anti-abuse heuristics.
- [ ] `R2-065` SkyeForms: form versioning with rollback.
- [ ] `R2-066` SkyeForms: certified response archive export.

- [ ] `R2-067` SkyeNotes: linked knowledge graph/action extraction.
- [ ] `R2-068` SkyeNotes: stale-note detection prompts.
- [ ] `R2-069` SkyeNotes: canonical source pinning/conflict warnings.
- [ ] `R2-070` SkyeNotes: decision-to-task conversion helper.

- [ ] `R2-071` SkyeSlides: narrative coherence scoring.
- [ ] `R2-072` SkyeSlides: sensitive text policy checks.
- [ ] `R2-073` SkyeSlides: speaker timeline rehearsal report.
- [ ] `R2-074` SkyeSlides: approved export pipeline manifest.

- [ ] `R2-075` SkyeSheets: dependency-aware formula audit map.
- [ ] `R2-076` SkyeSheets: row-level validation + exception report.
- [ ] `R2-077` SkyeSheets: branded scheduled report generation.
- [ ] `R2-078` SkyeSheets: signed workbook export integrity summary.

- [ ] `R2-079` SkyeAnalytics: metric confidence scoring.
- [ ] `R2-080` SkyeAnalytics: anomaly classifier explainability.
- [ ] `R2-081` SkyeAnalytics: executive mode dashboards.
- [ ] `R2-082` SkyeAnalytics: KPI source lineage explorer.

- [ ] `R2-083` SkyeAdmin: access review campaign engine.
- [ ] `R2-084` SkyeAdmin: org policy templates with enforcement preview.
- [ ] `R2-085` SkyeAdmin: risky action approval queue.
- [ ] `R2-086` SkyeAdmin: admin audit pack export.

## 4) Engineering and CI

- [ ] `R2-087` Add static scan to block direct external AI endpoints.
- [ ] `R2-088` Add fixture-based tests for gateway response shape tolerance.
- [ ] `R2-089` Add regression suite for key auth flows.
- [ ] `R2-090` Add schema tests for export/import payloads.
- [ ] `R2-091` Add deterministic smoke output snapshots.
- [ ] `R2-092` Add release artifact generator.

## 5) Release Gates

- [ ] `R2-093` Security gate pass criteria implemented.
- [ ] `R2-094` Reliability gate pass criteria implemented.
- [ ] `R2-095` Data integrity gate pass criteria implemented.
- [ ] `R2-096` Executive readiness gate pass criteria implemented.

## 6) Protected Apps

- [ ] `R2-097` Preserve no-touch rule for SkyeDocxPro.
- [ ] `R2-098` Preserve no-touch rule for Skye-ID.
- [ ] `R2-099` Preserve no-touch rule for SKYEMAIL-GEN.
