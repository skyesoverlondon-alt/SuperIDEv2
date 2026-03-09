
# GBP Rescue Platform — Phase 3 Ledger

## Summary
- Phase: 3
- Delivery type: full cumulative repo build
- Files added this phase: 65
- Total repository file count: 184
- Route files: 24
- Endpoint count: 39
- UI page count: 18
- Migrations total: 7
- Migrations added this phase: 3

## Top-level folders
- apps
- packages
- infra
- docs
- scripts

## Top 10 capability additions
- workspace and member management surfaces
- tenant-aware role badges and role primitives
- analytics dashboard and case metrics endpoints
- support ticket operations lane
- trust center UI and trust API
- queue operations UI with job endpoints
- feature flag endpoint and operator surface
- event stream UI and API lane
- signed export primitive library
- new D1 migrations for workspaces, queues, support, analytics, and flags

## Newly added files
- apps/web/src/components/AnalyticsChartCard.tsx
- apps/web/src/components/EventStreamList.tsx
- apps/web/src/components/FlagTable.tsx
- apps/web/src/components/QueueJobTable.tsx
- apps/web/src/components/RoleBadge.tsx
- apps/web/src/components/SupportTicketTable.tsx
- apps/web/src/components/TrustPillarCard.tsx
- apps/web/src/components/WorkspaceCard.tsx
- apps/web/src/lib/api.analytics.ts
- apps/web/src/lib/api.events.ts
- apps/web/src/lib/api.flags.ts
- apps/web/src/lib/api.members.ts
- apps/web/src/lib/api.queue.ts
- apps/web/src/lib/api.support.ts
- apps/web/src/lib/api.trust.ts
- apps/web/src/lib/api.workspaces.ts
- apps/web/src/pages/Analytics.tsx
- apps/web/src/pages/EventStream.tsx
- apps/web/src/pages/Members.tsx
- apps/web/src/pages/QueueOps.tsx
- apps/web/src/pages/Support.tsx
- apps/web/src/pages/TrustCenter.tsx
- apps/web/src/pages/Workspaces.tsx
- apps/worker-api/src/jobs/build-analytics-snapshot.ts
- apps/worker-api/src/jobs/process-support-queue.ts
- apps/worker-api/src/jobs/sign-export.ts
- apps/worker-api/src/lib/analytics.ts
- apps/worker-api/src/lib/event-stream.ts
- apps/worker-api/src/lib/feature-flags.ts
- apps/worker-api/src/lib/members.ts
- apps/worker-api/src/lib/queues.ts
- apps/worker-api/src/lib/rbac.ts
- apps/worker-api/src/lib/signing.ts
- apps/worker-api/src/lib/support.ts
- apps/worker-api/src/lib/trust.ts
- apps/worker-api/src/lib/usage-ledger.ts
- apps/worker-api/src/lib/workspace-db.ts
- apps/worker-api/src/lib/workspaces.ts
- apps/worker-api/src/routes/analytics.ts
- apps/worker-api/src/routes/event-stream.ts
- apps/worker-api/src/routes/feature-flags.ts
- apps/worker-api/src/routes/members.ts
- apps/worker-api/src/routes/queues.ts
- apps/worker-api/src/routes/support.ts
- apps/worker-api/src/routes/trust.ts
- apps/worker-api/src/routes/workspaces.ts
- apps/worker-api/src/templates/support-ticket-reply.ts
- docs/analytics.md
- docs/queues.md
- docs/support-ops.md
- docs/trust-center.md
- docs/workspaces.md
- infra/migrations/005_workspaces_and_members.sql
- infra/migrations/006_queue_jobs_and_support.sql
- infra/migrations/007_analytics_and_flags.sql
- packages/prompts/src/reinstatement-hardening.ts
- packages/prompts/src/support-triage.ts
- packages/types/src/phase3.ts
- packages/ui/src/cards.ts
- packages/utils/src/id.ts
- packages/utils/src/signature.ts
- scripts/seed-analytics-demo.mjs
- scripts/seed-workspace-demo.mjs
- scripts/verify-phase3.mjs

## Modified existing files
- README.md
- docs/routes.md
- apps/web/src/App.tsx
- apps/worker-api/src/index.ts
- apps/worker-api/src/types.ts

## New routes and endpoints added this phase
- GET /v1/workspaces
- POST /v1/workspaces
- GET /v1/members
- POST /v1/members/invite
- GET /v1/analytics/overview
- GET /v1/analytics/cases
- GET /v1/support/tickets
- POST /v1/support/tickets
- GET /v1/trust-center
- GET /v1/queues/jobs
- POST /v1/queues/jobs
- GET /v1/events/stream
- GET /v1/flags

## New migrations added this phase
- infra/migrations/005_workspaces_and_members.sql
- infra/migrations/006_queue_jobs_and_support.sql
- infra/migrations/007_analytics_and_flags.sql

## Deployment notes
- Still Cloudflare-native: Pages frontend + Worker API + D1 + KV + R2.
- Queue-backed execution is scaffolded through queue-oriented libraries and queue job endpoints.
- Signed export support is introduced at the primitive/helper level and should be wired to real secret material in production.
- Workspace/member/analytics/support flows are now part of the cumulative build; this phase does not remove any prior Phase 1 or Phase 2 surface.

## Next phase delta plan
Phase 4 should push into the resale/scaling layer:
- agency multi-client controls
- white-label branding controls
- prompt/template registry
- industry presets
- collaboration notes
- branded exports
- partner/referral tracking
- platform ops dashboards

## Exact file tree
```text
├── .editorconfig
├── .gitignore
├── .npmrc
├── README.md
├── apps
│   ├── web
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── public
│   │   │   └── manifest.webmanifest
│   │   ├── src
│   │   │   ├── App.tsx
│   │   │   ├── components
│   │   │   │   ├── AdminQueueTable.tsx
│   │   │   │   ├── AnalyticsChartCard.tsx
│   │   │   │   ├── CaseTimeline.tsx
│   │   │   │   ├── CaseWizardSteps.tsx
│   │   │   │   ├── ChecklistBoard.tsx
│   │   │   │   ├── EventStreamList.tsx
│   │   │   │   ├── EvidenceUploader.tsx
│   │   │   │   ├── FlagTable.tsx
│   │   │   │   ├── MonitoringCard.tsx
│   │   │   │   ├── NavBar.tsx
│   │   │   │   ├── NotificationCenter.tsx
│   │   │   │   ├── PlanCard.tsx
│   │   │   │   ├── QueueJobTable.tsx
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
│   │   │   │   ├── api.billing.ts
│   │   │   │   ├── api.cases.ts
│   │   │   │   ├── api.events.ts
│   │   │   │   ├── api.flags.ts
│   │   │   │   ├── api.members.ts
│   │   │   │   ├── api.monitoring.ts
│   │   │   │   ├── api.notifications.ts
│   │   │   │   ├── api.queue.ts
│   │   │   │   ├── api.support.ts
│   │   │   │   ├── api.trust.ts
│   │   │   │   ├── api.ts
│   │   │   │   ├── api.workspaces.ts
│   │   │   │   ├── format.ts
│   │   │   │   └── session.ts
│   │   │   ├── main.tsx
│   │   │   ├── pages
│   │   │   │   ├── Admin.tsx
│   │   │   │   ├── Analytics.tsx
│   │   │   │   ├── Billing.tsx
│   │   │   │   ├── CaseDetail.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── EventStream.tsx
│   │   │   │   ├── Exports.tsx
│   │   │   │   ├── Landing.tsx
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Members.tsx
│   │   │   │   ├── Monitoring.tsx
│   │   │   │   ├── NewCase.tsx
│   │   │   │   ├── Notifications.tsx
│   │   │   │   ├── QueueOps.tsx
│   │   │   │   ├── Settings.tsx
│   │   │   │   ├── Support.tsx
│   │   │   │   ├── TrustCenter.tsx
│   │   │   │   └── Workspaces.tsx
│   │   │   ├── styles
│   │   │   │   └── global.css
│   │   │   └── types
│   │   │       └── ui.ts
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── worker-api
│       ├── package.json
│       ├── src
│       │   ├── index.ts
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
│       │   │   ├── queues.ts
│       │   │   ├── rbac.ts
│       │   │   ├── settings.ts
│       │   │   ├── signing.ts
│       │   │   ├── storage.ts
│       │   │   ├── support.ts
│       │   │   ├── trust.ts
│       │   │   ├── usage-ledger.ts
│       │   │   ├── validators.ts
│       │   │   ├── workspace-db.ts
│       │   │   └── workspaces.ts
│       │   ├── routes
│       │   │   ├── admin.ts
│       │   │   ├── analytics.ts
│       │   │   ├── audit.ts
│       │   │   ├── auth.ts
│       │   │   ├── billing.ts
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
│       │   │   ├── support.ts
│       │   │   ├── timelines.ts
│       │   │   ├── trust.ts
│       │   │   ├── uploads.ts
│       │   │   ├── webhooks.ts
│       │   │   └── workspaces.ts
│       │   ├── templates
│       │   │   ├── export-cover.ts
│       │   │   ├── reinstatement-email.ts
│       │   │   └── support-ticket-reply.ts
│       │   └── types.ts
│       ├── tsconfig.json
│       └── wrangler.toml
├── docs
│   ├── analytics.md
│   ├── api-phase2.md
│   ├── architecture.md
│   ├── billing-flow.md
│   ├── deployment.md
│   ├── monitoring.md
│   ├── operations.md
│   ├── phase-1-ledger.md
│   ├── phase-2-ledger.md
│   ├── phase-3-ledger.md
│   ├── product.md
│   ├── queues.md
│   ├── routes.md
│   ├── security-notes.md
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
│       └── 007_analytics_and_flags.sql
├── package.json
├── packages
│   ├── config
│   │   ├── package.json
│   │   └── src
│   │       └── index.ts
│   ├── prompts
│   │   ├── package.json
│   │   └── src
│   │       ├── index.ts
│   │       ├── monitoring.ts
│   │       ├── reinstatement-hardening.ts
│   │       └── support-triage.ts
│   ├── types
│   │   ├── package.json
│   │   └── src
│   │       ├── index.ts
│   │       ├── phase2.ts
│   │       └── phase3.ts
│   ├── ui
│   │   ├── package.json
│   │   └── src
│   │       ├── cards.ts
│   │       └── index.ts
│   └── utils
│       ├── package.json
│       └── src
│           ├── date.ts
│           ├── id.ts
│           ├── index.ts
│           └── signature.ts
├── pnpm-workspace.yaml
├── scripts
│   ├── bootstrap.mjs
│   ├── count-files.mjs
│   ├── seed-analytics-demo.mjs
│   ├── seed-demo-case.mjs
│   ├── seed-monitoring-demo.mjs
│   ├── seed-workspace-demo.mjs
│   ├── verify-phase1.mjs
│   ├── verify-phase2.mjs
│   └── verify-phase3.mjs
└── tsconfig.base.json
```

## Exact repository file list
```text
.editorconfig
.gitignore
.npmrc
README.md
apps/web/index.html
apps/web/package.json
apps/web/public/manifest.webmanifest
apps/web/src/App.tsx
apps/web/src/components/AdminQueueTable.tsx
apps/web/src/components/AnalyticsChartCard.tsx
apps/web/src/components/CaseTimeline.tsx
apps/web/src/components/CaseWizardSteps.tsx
apps/web/src/components/ChecklistBoard.tsx
apps/web/src/components/EventStreamList.tsx
apps/web/src/components/EvidenceUploader.tsx
apps/web/src/components/FlagTable.tsx
apps/web/src/components/MonitoringCard.tsx
apps/web/src/components/NavBar.tsx
apps/web/src/components/NotificationCenter.tsx
apps/web/src/components/PlanCard.tsx
apps/web/src/components/QueueJobTable.tsx
apps/web/src/components/RoleBadge.tsx
apps/web/src/components/SettingsForm.tsx
apps/web/src/components/StatusCard.tsx
apps/web/src/components/SupportTicketTable.tsx
apps/web/src/components/TrustPillarCard.tsx
apps/web/src/components/WorkspaceCard.tsx
apps/web/src/hooks/useAsync.ts
apps/web/src/hooks/usePolling.ts
apps/web/src/lib/api.analytics.ts
apps/web/src/lib/api.billing.ts
apps/web/src/lib/api.cases.ts
apps/web/src/lib/api.events.ts
apps/web/src/lib/api.flags.ts
apps/web/src/lib/api.members.ts
apps/web/src/lib/api.monitoring.ts
apps/web/src/lib/api.notifications.ts
apps/web/src/lib/api.queue.ts
apps/web/src/lib/api.support.ts
apps/web/src/lib/api.trust.ts
apps/web/src/lib/api.ts
apps/web/src/lib/api.workspaces.ts
apps/web/src/lib/format.ts
apps/web/src/lib/session.ts
apps/web/src/main.tsx
apps/web/src/pages/Admin.tsx
apps/web/src/pages/Analytics.tsx
apps/web/src/pages/Billing.tsx
apps/web/src/pages/CaseDetail.tsx
apps/web/src/pages/Dashboard.tsx
apps/web/src/pages/EventStream.tsx
apps/web/src/pages/Exports.tsx
apps/web/src/pages/Landing.tsx
apps/web/src/pages/Login.tsx
apps/web/src/pages/Members.tsx
apps/web/src/pages/Monitoring.tsx
apps/web/src/pages/NewCase.tsx
apps/web/src/pages/Notifications.tsx
apps/web/src/pages/QueueOps.tsx
apps/web/src/pages/Settings.tsx
apps/web/src/pages/Support.tsx
apps/web/src/pages/TrustCenter.tsx
apps/web/src/pages/Workspaces.tsx
apps/web/src/styles/global.css
apps/web/src/types/ui.ts
apps/web/tsconfig.json
apps/web/vite.config.ts
apps/worker-api/package.json
apps/worker-api/src/index.ts
apps/worker-api/src/jobs/build-analytics-snapshot.ts
apps/worker-api/src/jobs/listing-monitor.ts
apps/worker-api/src/jobs/notify-users.ts
apps/worker-api/src/jobs/process-support-queue.ts
apps/worker-api/src/jobs/sign-export.ts
apps/worker-api/src/lib/ai.ts
apps/worker-api/src/lib/analytics.ts
apps/worker-api/src/lib/auth.ts
apps/worker-api/src/lib/billing.ts
apps/worker-api/src/lib/checklist.ts
apps/worker-api/src/lib/db.ts
apps/worker-api/src/lib/email.ts
apps/worker-api/src/lib/event-stream.ts
apps/worker-api/src/lib/events.ts
apps/worker-api/src/lib/exports.ts
apps/worker-api/src/lib/feature-flags.ts
apps/worker-api/src/lib/http.ts
apps/worker-api/src/lib/members.ts
apps/worker-api/src/lib/monitoring.ts
apps/worker-api/src/lib/queues.ts
apps/worker-api/src/lib/rbac.ts
apps/worker-api/src/lib/settings.ts
apps/worker-api/src/lib/signing.ts
apps/worker-api/src/lib/storage.ts
apps/worker-api/src/lib/support.ts
apps/worker-api/src/lib/trust.ts
apps/worker-api/src/lib/usage-ledger.ts
apps/worker-api/src/lib/validators.ts
apps/worker-api/src/lib/workspace-db.ts
apps/worker-api/src/lib/workspaces.ts
apps/worker-api/src/routes/admin.ts
apps/worker-api/src/routes/analytics.ts
apps/worker-api/src/routes/audit.ts
apps/worker-api/src/routes/auth.ts
apps/worker-api/src/routes/billing.ts
apps/worker-api/src/routes/cases.ts
apps/worker-api/src/routes/checklists.ts
apps/worker-api/src/routes/diagnostics.ts
apps/worker-api/src/routes/event-stream.ts
apps/worker-api/src/routes/exports.ts
apps/worker-api/src/routes/feature-flags.ts
apps/worker-api/src/routes/health.ts
apps/worker-api/src/routes/letters.ts
apps/worker-api/src/routes/members.ts
apps/worker-api/src/routes/monitoring.ts
apps/worker-api/src/routes/notifications.ts
apps/worker-api/src/routes/queues.ts
apps/worker-api/src/routes/settings.ts
apps/worker-api/src/routes/support.ts
apps/worker-api/src/routes/timelines.ts
apps/worker-api/src/routes/trust.ts
apps/worker-api/src/routes/uploads.ts
apps/worker-api/src/routes/webhooks.ts
apps/worker-api/src/routes/workspaces.ts
apps/worker-api/src/templates/export-cover.ts
apps/worker-api/src/templates/reinstatement-email.ts
apps/worker-api/src/templates/support-ticket-reply.ts
apps/worker-api/src/types.ts
apps/worker-api/tsconfig.json
apps/worker-api/wrangler.toml
docs/analytics.md
docs/api-phase2.md
docs/architecture.md
docs/billing-flow.md
docs/deployment.md
docs/monitoring.md
docs/operations.md
docs/phase-1-ledger.md
docs/phase-2-ledger.md
docs/phase-3-ledger.md
docs/product.md
docs/queues.md
docs/routes.md
docs/security-notes.md
docs/support-ops.md
docs/trust-center.md
docs/workspaces.md
infra/migrations/001_init.sql
infra/migrations/002_seed_reference_data.sql
infra/migrations/003_case_events.sql
infra/migrations/004_settings_and_monitoring.sql
infra/migrations/005_workspaces_and_members.sql
infra/migrations/006_queue_jobs_and_support.sql
infra/migrations/007_analytics_and_flags.sql
package.json
packages/config/package.json
packages/config/src/index.ts
packages/prompts/package.json
packages/prompts/src/index.ts
packages/prompts/src/monitoring.ts
packages/prompts/src/reinstatement-hardening.ts
packages/prompts/src/support-triage.ts
packages/types/package.json
packages/types/src/index.ts
packages/types/src/phase2.ts
packages/types/src/phase3.ts
packages/ui/package.json
packages/ui/src/cards.ts
packages/ui/src/index.ts
packages/utils/package.json
packages/utils/src/date.ts
packages/utils/src/id.ts
packages/utils/src/index.ts
packages/utils/src/signature.ts
pnpm-workspace.yaml
scripts/bootstrap.mjs
scripts/count-files.mjs
scripts/seed-analytics-demo.mjs
scripts/seed-demo-case.mjs
scripts/seed-monitoring-demo.mjs
scripts/seed-workspace-demo.mjs
scripts/verify-phase1.mjs
scripts/verify-phase2.mjs
scripts/verify-phase3.mjs
tsconfig.base.json
```
