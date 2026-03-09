# Phase 5 Ledger — Production Closeout

## File Count Summary
- Files added this phase: 25
- Total repository file count: 230
- Route files: 27
- Endpoint count: 47
- UI pages: 20
- Migrations total: 12 (3 new this phase)

## Top-level Tree
```text
├── apps
│   ├── web
│   │   ├── public
│   │   │   ├── _headers
│   │   │   ├── _redirects
│   │   │   └── manifest.webmanifest
│   │   ├── src
│   │   │   ├── components
│   │   │   │   ├── AdminQueueTable.tsx
│   │   │   │   ├── AnalyticsChartCard.tsx
│   │   │   │   ├── CaseTimeline.tsx
│   │   │   │   ├── CaseWizardSteps.tsx
│   │   │   │   ├── ChecklistBoard.tsx
│   │   │   │   ├── ConfigStatusCard.tsx
│   │   │   │   ├── EventStreamList.tsx
│   │   │   │   ├── EvidenceUploader.tsx
│   │   │   │   ├── FlagTable.tsx
│   │   │   │   ├── MonitoringCard.tsx
│   │   │   │   ├── NavBar.tsx
│   │   │   │   ├── NotificationCenter.tsx
│   │   │   │   ├── PlanCard.tsx
│   │   │   │   ├── QueueJobTable.tsx
│   │   │   │   ├── ReleaseCheckTable.tsx
│   │   │   │   ├── RoleBadge.tsx
│   │   │   │   ├── SettingsForm.tsx
│   │   │   │   ├── StatusCard.tsx
│   │   │   │   ├── SupportTicketTable.tsx
│   │   │   │   ├── TrustPillarCard.tsx
│   │   │   │   └── WorkspaceCard.tsx
│   │   │   ├── hooks
│   │   │   │   ├── useAsync.ts
│   │   │   │   └── usePolling.ts
│   │   │   ├── lib
│   │   │   │   ├── api.analytics.ts
│   │   │   │   ├── api.auth.ts
│   │   │   │   ├── api.billing.ts
│   │   │   │   ├── api.bootstrap.ts
│   │   │   │   ├── api.cases.ts
│   │   │   │   ├── api.events.ts
│   │   │   │   ├── api.flags.ts
│   │   │   │   ├── api.members.ts
│   │   │   │   ├── api.monitoring.ts
│   │   │   │   ├── api.notifications.ts
│   │   │   │   ├── api.queue.ts
│   │   │   │   ├── api.smoke.ts
│   │   │   │   ├── api.support.ts
│   │   │   │   ├── api.system.ts
│   │   │   │   ├── api.trust.ts
│   │   │   │   ├── api.ts
│   │   │   │   ├── api.workspaces.ts
│   │   │   │   ├── format.ts
│   │   │   │   └── session.ts
│   │   │   ├── pages
│   │   │   │   ├── Admin.tsx
│   │   │   │   ├── Analytics.tsx
│   │   │   │   ├── Billing.tsx
│   │   │   │   ├── CaseDetail.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── EventStream.tsx
│   │   │   │   ├── Exports.tsx
│   │   │   │   ├── FirstRun.tsx
│   │   │   │   ├── Landing.tsx
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Members.tsx
│   │   │   │   ├── Monitoring.tsx
│   │   │   │   ├── NewCase.tsx
│   │   │   │   ├── Notifications.tsx
│   │   │   │   ├── QueueOps.tsx
│   │   │   │   ├── ReleaseReadiness.tsx
│   │   │   │   ├── Settings.tsx
│   │   │   │   ├── Support.tsx
│   │   │   │   ├── TrustCenter.tsx
│   │   │   │   └── Workspaces.tsx
│   │   │   ├── styles
│   │   │   │   └── global.css
│   │   │   ├── types
│   │   │   │   └── ui.ts
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── vite-env.d.ts
│   │   ├── .env.example
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── worker-api
│       ├── src
│       │   ├── jobs
│       │   │   ├── build-analytics-snapshot.ts
│       │   │   ├── listing-monitor.ts
│       │   │   ├── notify-users.ts
│       │   │   ├── process-support-queue.ts
│       │   │   └── sign-export.ts
│       │   ├── lib
│       │   │   ├── ai.ts
│       │   │   ├── analytics.ts
│       │   │   ├── auth.ts
│       │   │   ├── billing.ts
│       │   │   ├── bootstrap.ts
│       │   │   ├── checklist.ts
│       │   │   ├── db.ts
│       │   │   ├── email.ts
│       │   │   ├── event-stream.ts
│       │   │   ├── events.ts
│       │   │   ├── exports.ts
│       │   │   ├── feature-flags.ts
│       │   │   ├── http.ts
│       │   │   ├── members.ts
│       │   │   ├── monitoring.ts
│       │   │   ├── password.ts
│       │   │   ├── queues.ts
│       │   │   ├── rbac.ts
│       │   │   ├── resource-config.ts
│       │   │   ├── settings.ts
│       │   │   ├── signing.ts
│       │   │   ├── smoke.ts
│       │   │   ├── storage.ts
│       │   │   ├── support.ts
│       │   │   ├── trust.ts
│       │   │   ├── usage-ledger.ts
│       │   │   ├── validators.ts
│       │   │   ├── workspace-db.ts
│       │   │   └── workspaces.ts
│       │   ├── middleware
│       │   │   ├── require-auth.ts
│       │   │   └── require-role.ts
│       │   ├── routes
│       │   │   ├── admin.ts
│       │   │   ├── analytics.ts
│       │   │   ├── audit.ts
│       │   │   ├── auth.ts
│       │   │   ├── billing.ts
│       │   │   ├── bootstrap.ts
│       │   │   ├── cases.ts
│       │   │   ├── checklists.ts
│       │   │   ├── diagnostics.ts
│       │   │   ├── event-stream.ts
│       │   │   ├── exports.ts
│       │   │   ├── feature-flags.ts
│       │   │   ├── health.ts
│       │   │   ├── letters.ts
│       │   │   ├── members.ts
│       │   │   ├── monitoring.ts
│       │   │   ├── notifications.ts
│       │   │   ├── queues.ts
│       │   │   ├── settings.ts
│       │   │   ├── smoke.ts
│       │   │   ├── support.ts
│       │   │   ├── system.ts
│       │   │   ├── timelines.ts
│       │   │   ├── trust.ts
│       │   │   ├── uploads.ts
│       │   │   ├── webhooks.ts
│       │   │   └── workspaces.ts
│       │   ├── templates
│       │   │   ├── export-cover.ts
│       │   │   ├── reinstatement-email.ts
│       │   │   └── support-ticket-reply.ts
│       │   ├── index.ts
│       │   └── types.ts
│       ├── .dev.vars.example
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.toml
├── docs
│   ├── analytics.md
│   ├── api-phase2.md
│   ├── architecture.md
│   ├── auth-hardening.md
│   ├── backup-restore.md
│   ├── billing-flow.md
│   ├── cloudflare-pages.md
│   ├── cloudflare-resource-wiring.md
│   ├── deployable-release.md
│   ├── deployment.md
│   ├── env-matrix.md
│   ├── monitoring.md
│   ├── operations.md
│   ├── phase-1-ledger.md
│   ├── phase-2-ledger.md
│   ├── phase-3-ledger.md
│   ├── phase-4-ledger.md
│   ├── product.md
│   ├── production-closeout.md
│   ├── queues.md
│   ├── release-checklist.md
│   ├── routes.md
│   ├── runbook.md
│   ├── security-notes.md
│   ├── smoke-checklist.md
│   ├── smoke-report-template.md
│   ├── support-ops.md
│   ├── trust-center.md
│   └── workspaces.md
├── infra
│   └── migrations
│       ├── 001_init.sql
│       ├── 002_seed_reference_data.sql
│       ├── 003_case_events.sql
│       ├── 004_settings_and_monitoring.sql
│       ├── 005_workspaces_and_members.sql
│       ├── 006_queue_jobs_and_support.sql
│       ├── 007_analytics_and_flags.sql
│       ├── 008_auth_and_sessions.sql
│       ├── 009_case_status_views.sql
│       ├── 010_case_workspace_ownership.sql
│       ├── 011_hardening_indexes.sql
│       └── 012_smoke_runs.sql
├── packages
│   ├── config
│   │   ├── src
│   │   │   └── index.ts
│   │   └── package.json
│   ├── prompts
│   │   ├── src
│   │   │   ├── index.ts
│   │   │   ├── monitoring.ts
│   │   │   ├── reinstatement-hardening.ts
│   │   │   └── support-triage.ts
│   │   └── package.json
│   ├── types
│   │   ├── src
│   │   │   ├── index.ts
│   │   │   ├── phase2.ts
│   │   │   └── phase3.ts
│   │   └── package.json
│   ├── ui
│   │   ├── src
│   │   │   ├── cards.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── utils
│       ├── src
│       │   ├── date.ts
│       │   ├── id.ts
│       │   ├── index.ts
│       │   └── signature.ts
│       └── package.json
├── scripts
│   ├── apply-migrations.mjs
│   ├── bootstrap-local.mjs
│   ├── bootstrap.mjs
│   ├── count-files.mjs
│   ├── generate-local-secrets.mjs
│   ├── provision-cloudflare-resources.mjs
│   ├── release-closeout.mjs
│   ├── release-smoke.mjs
│   ├── seed-analytics-demo.mjs
│   ├── seed-demo-case.mjs
│   ├── seed-monitoring-demo.mjs
│   ├── seed-workspace-demo.mjs
│   ├── smoke-live.mjs
│   ├── verify-phase1.mjs
│   ├── verify-phase2.mjs
│   └── verify-phase3.mjs
├── .editorconfig
├── .gitignore
├── .npmrc
├── package.json
├── pnpm-workspace.yaml
├── README.md
└── tsconfig.base.json
```

## Newly Added Files

- `apps/web/src/components/ConfigStatusCard.tsx`
- `apps/web/src/components/ReleaseCheckTable.tsx`
- `apps/web/src/lib/api.smoke.ts`
- `apps/web/src/lib/api.system.ts`
- `apps/web/src/pages/ReleaseReadiness.tsx`
- `apps/worker-api/src/lib/resource-config.ts`
- `apps/worker-api/src/lib/smoke.ts`
- `apps/worker-api/src/middleware/require-auth.ts`
- `apps/worker-api/src/middleware/require-role.ts`
- `apps/worker-api/src/routes/smoke.ts`
- `apps/worker-api/src/routes/system.ts`
- `docs/auth-hardening.md`
- `docs/backup-restore.md`
- `docs/cloudflare-resource-wiring.md`
- `docs/production-closeout.md`
- `docs/release-checklist.md`
- `docs/smoke-report-template.md`
- `infra/migrations/010_case_workspace_ownership.sql`
- `infra/migrations/011_hardening_indexes.sql`
- `infra/migrations/012_smoke_runs.sql`
- `scripts/apply-migrations.mjs`
- `scripts/generate-local-secrets.mjs`
- `scripts/provision-cloudflare-resources.mjs`
- `scripts/release-closeout.mjs`
- `scripts/smoke-live.mjs`

## Route Files

- `apps/worker-api/src/routes/admin.ts`
- `apps/worker-api/src/routes/analytics.ts`
- `apps/worker-api/src/routes/audit.ts`
- `apps/worker-api/src/routes/auth.ts`
- `apps/worker-api/src/routes/billing.ts`
- `apps/worker-api/src/routes/bootstrap.ts`
- `apps/worker-api/src/routes/cases.ts`
- `apps/worker-api/src/routes/checklists.ts`
- `apps/worker-api/src/routes/diagnostics.ts`
- `apps/worker-api/src/routes/event-stream.ts`
- `apps/worker-api/src/routes/exports.ts`
- `apps/worker-api/src/routes/feature-flags.ts`
- `apps/worker-api/src/routes/health.ts`
- `apps/worker-api/src/routes/letters.ts`
- `apps/worker-api/src/routes/members.ts`
- `apps/worker-api/src/routes/monitoring.ts`
- `apps/worker-api/src/routes/notifications.ts`
- `apps/worker-api/src/routes/queues.ts`
- `apps/worker-api/src/routes/settings.ts`
- `apps/worker-api/src/routes/smoke.ts`
- `apps/worker-api/src/routes/support.ts`
- `apps/worker-api/src/routes/system.ts`
- `apps/worker-api/src/routes/timelines.ts`
- `apps/worker-api/src/routes/trust.ts`
- `apps/worker-api/src/routes/uploads.ts`
- `apps/worker-api/src/routes/webhooks.ts`
- `apps/worker-api/src/routes/workspaces.ts`

## Routes / Endpoints Added This Phase

- `GET /v1/system/config`
- `GET /v1/system/release-readiness`
- `GET /v1/smoke/run`
- `GET /v1/smoke/history`

## Migrations Added This Phase

- `infra/migrations/010_case_workspace_ownership.sql`
- `infra/migrations/011_hardening_indexes.sql`
- `infra/migrations/012_smoke_runs.sql`

## Deployment Notes

- Set real Cloudflare IDs and secrets in `apps/worker-api/wrangler.toml` and `.dev.vars`.
- Apply migrations 001–012 to D1.
- Deploy Worker and Pages, then run `node scripts/smoke-live.mjs` against the live base URL.
- Production should run with `REQUIRE_AUTH_STRICT=true` to disable demo fallback.

## Material Capability Additions

- strict-auth default wiring
- workspace-scoped case ownership
- release-readiness API
- live smoke-run API + persistence
- Cloudflare resource config visibility
- closeout scripts for migrations and smoke
- release-readiness UI page