# Phase 2 Ledger

## Summary
- phase: Phase 2 — Operational Depth
- files added this phase: 52
- total repository file count: 119
- top-level folders added in this phase: none
- new nested folders added: apps/web/public, apps/web/src/hooks, apps/web/src/types, apps/worker-api/src/jobs, apps/worker-api/src/templates
- migration count: 4 total (2 added this phase)
- worker/API route count: 26
- UI page count: 11

## Top 10 capability additions
1. Case timeline feed with event history
2. Evidence checklist engine with toggle actions
3. Monitoring dashboard and on-demand listing checks
4. Notification queue surface and case notification endpoint
5. Workspace settings persistence layer
6. Export-pack generation for per-case operational bundles
7. Billing plan catalog and checkout session lane
8. Stripe webhook intake scaffold
9. Admin review queue with richer operational metrics
10. Audit event feed and cron-ready job scaffolds

## Exact file tree
```text
├── apps
│   ├── web
│   │   ├── public
│   │   │   └── manifest.webmanifest
│   │   ├── src
│   │   │   ├── components
│   │   │   │   ├── AdminQueueTable.tsx
│   │   │   │   ├── CaseTimeline.tsx
│   │   │   │   ├── CaseWizardSteps.tsx
│   │   │   │   ├── ChecklistBoard.tsx
│   │   │   │   ├── EvidenceUploader.tsx
│   │   │   │   ├── MonitoringCard.tsx
│   │   │   │   ├── NavBar.tsx
│   │   │   │   ├── NotificationCenter.tsx
│   │   │   │   ├── PlanCard.tsx
│   │   │   │   ├── SettingsForm.tsx
│   │   │   │   └── StatusCard.tsx
│   │   │   ├── hooks
│   │   │   │   ├── useAsync.ts
│   │   │   │   └── usePolling.ts
│   │   │   ├── lib
│   │   │   │   ├── api.billing.ts
│   │   │   │   ├── api.cases.ts
│   │   │   │   ├── api.monitoring.ts
│   │   │   │   ├── api.notifications.ts
│   │   │   │   ├── api.ts
│   │   │   │   ├── format.ts
│   │   │   │   └── session.ts
│   │   │   ├── pages
│   │   │   │   ├── Admin.tsx
│   │   │   │   ├── Billing.tsx
│   │   │   │   ├── CaseDetail.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Exports.tsx
│   │   │   │   ├── Landing.tsx
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Monitoring.tsx
│   │   │   │   ├── NewCase.tsx
│   │   │   │   ├── Notifications.tsx
│   │   │   │   └── Settings.tsx
│   │   │   ├── styles
│   │   │   │   └── global.css
│   │   │   ├── types
│   │   │   │   └── ui.ts
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── worker-api
│       ├── src
│       │   ├── jobs
│       │   │   ├── listing-monitor.ts
│       │   │   └── notify-users.ts
│       │   ├── lib
│       │   │   ├── ai.ts
│       │   │   ├── auth.ts
│       │   │   ├── billing.ts
│       │   │   ├── checklist.ts
│       │   │   ├── db.ts
│       │   │   ├── email.ts
│       │   │   ├── events.ts
│       │   │   ├── exports.ts
│       │   │   ├── http.ts
│       │   │   ├── monitoring.ts
│       │   │   ├── settings.ts
│       │   │   ├── storage.ts
│       │   │   └── validators.ts
│       │   ├── routes
│       │   │   ├── admin.ts
│       │   │   ├── audit.ts
│       │   │   ├── auth.ts
│       │   │   ├── billing.ts
│       │   │   ├── cases.ts
│       │   │   ├── checklists.ts
│       │   │   ├── diagnostics.ts
│       │   │   ├── exports.ts
│       │   │   ├── health.ts
│       │   │   ├── letters.ts
│       │   │   ├── monitoring.ts
│       │   │   ├── notifications.ts
│       │   │   ├── settings.ts
│       │   │   ├── timelines.ts
│       │   │   ├── uploads.ts
│       │   │   └── webhooks.ts
│       │   ├── templates
│       │   │   ├── export-cover.ts
│       │   │   └── reinstatement-email.ts
│       │   ├── index.ts
│       │   └── types.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.toml
├── docs
│   ├── api-phase2.md
│   ├── architecture.md
│   ├── billing-flow.md
│   ├── deployment.md
│   ├── monitoring.md
│   ├── operations.md
│   ├── phase-1-ledger.md
│   ├── phase-2-ledger.md
│   ├── product.md
│   ├── routes.md
│   └── security-notes.md
├── infra
│   └── migrations
│       ├── 001_init.sql
│       ├── 002_seed_reference_data.sql
│       ├── 003_case_events.sql
│       └── 004_settings_and_monitoring.sql
├── packages
│   ├── config
│   │   ├── src
│   │   │   └── index.ts
│   │   └── package.json
│   ├── prompts
│   │   ├── src
│   │   │   ├── index.ts
│   │   │   └── monitoring.ts
│   │   └── package.json
│   ├── types
│   │   ├── src
│   │   │   ├── index.ts
│   │   │   └── phase2.ts
│   │   └── package.json
│   ├── ui
│   │   ├── src
│   │   │   └── index.ts
│   │   └── package.json
│   └── utils
│       ├── src
│       │   ├── date.ts
│       │   └── index.ts
│       └── package.json
├── scripts
│   ├── bootstrap.mjs
│   ├── count-files.mjs
│   ├── seed-demo-case.mjs
│   ├── seed-monitoring-demo.mjs
│   ├── verify-phase1.mjs
│   └── verify-phase2.mjs
├── .editorconfig
├── .gitignore
├── .npmrc
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Exact list of newly added files in Phase 2
```text
apps/web/public/manifest.webmanifest
apps/web/src/components/AdminQueueTable.tsx
apps/web/src/components/CaseTimeline.tsx
apps/web/src/components/ChecklistBoard.tsx
apps/web/src/components/EvidenceUploader.tsx
apps/web/src/components/MonitoringCard.tsx
apps/web/src/components/NotificationCenter.tsx
apps/web/src/components/PlanCard.tsx
apps/web/src/components/SettingsForm.tsx
apps/web/src/hooks/useAsync.ts
apps/web/src/hooks/usePolling.ts
apps/web/src/lib/api.billing.ts
apps/web/src/lib/api.cases.ts
apps/web/src/lib/api.monitoring.ts
apps/web/src/lib/api.notifications.ts
apps/web/src/lib/format.ts
apps/web/src/pages/Exports.tsx
apps/web/src/pages/Monitoring.tsx
apps/web/src/pages/Notifications.tsx
apps/web/src/types/ui.ts
apps/worker-api/src/jobs/listing-monitor.ts
apps/worker-api/src/jobs/notify-users.ts
apps/worker-api/src/lib/billing.ts
apps/worker-api/src/lib/checklist.ts
apps/worker-api/src/lib/email.ts
apps/worker-api/src/lib/events.ts
apps/worker-api/src/lib/exports.ts
apps/worker-api/src/lib/monitoring.ts
apps/worker-api/src/lib/settings.ts
apps/worker-api/src/lib/storage.ts
apps/worker-api/src/routes/audit.ts
apps/worker-api/src/routes/checklists.ts
apps/worker-api/src/routes/exports.ts
apps/worker-api/src/routes/monitoring.ts
apps/worker-api/src/routes/notifications.ts
apps/worker-api/src/routes/settings.ts
apps/worker-api/src/routes/timelines.ts
apps/worker-api/src/routes/webhooks.ts
apps/worker-api/src/templates/export-cover.ts
apps/worker-api/src/templates/reinstatement-email.ts
docs/api-phase2.md
docs/billing-flow.md
docs/monitoring.md
docs/operations.md
docs/phase-2-ledger.md
infra/migrations/003_case_events.sql
infra/migrations/004_settings_and_monitoring.sql
packages/prompts/src/monitoring.ts
packages/types/src/phase2.ts
packages/utils/src/date.ts
scripts/seed-monitoring-demo.mjs
scripts/verify-phase2.mjs
```

## Exact routes/endpoints after Phase 2
### Worker API
- GET /
- GET /v1/health
- GET /v1/session
- GET /v1/cases
- POST /v1/cases
- GET /v1/cases/:caseId
- POST /v1/cases/:caseId/diagnosis
- POST /v1/cases/:caseId/reinstatement-letter
- POST /v1/cases/:caseId/evidence
- GET /v1/admin/overview
- GET /v1/billing/summary
- GET /v1/cases/:caseId/timeline
- GET /v1/cases/:caseId/checklist
- POST /v1/cases/:caseId/checklist/:itemId/toggle
- POST /v1/cases/:caseId/evidence/upload
- GET /v1/monitoring
- POST /v1/monitoring/:caseId/run
- GET /v1/notifications
- POST /v1/cases/:caseId/notifications/send
- GET /v1/settings
- POST /v1/settings
- GET /v1/cases/:caseId/export-pack
- GET /v1/audit/events
- GET /v1/billing/plans
- POST /v1/billing/checkout
- POST /v1/webhooks/stripe

### Frontend pages
- /
- /login
- /app
- /app/new-case
- /app/cases/:caseId
- /app/monitoring
- /app/notifications
- /app/exports
- /app/billing
- /app/settings
- /app/admin

## Exact migrations added in Phase 2
- infra/migrations/003_case_events.sql
- infra/migrations/004_settings_and_monitoring.sql

## Deployment notes
- Frontend still targets Cloudflare Pages.
- API still targets Cloudflare Workers.
- Evidence upload uses R2 when bound and otherwise stays no-op safe for local dev.
- Monitoring and notification jobs are scaffolded for cron/queue wiring, but provider-grade adapters still deepen in later phases.
- Stripe webhook intake exists, but signature validation and durable billing state hardening are deferred.

## Next phase delta plan
- org/workspace model
- member roles and invitation flow
- background queue execution with stronger event persistence
- signed export bundles
- deeper analytics and trust center surfaces
- support tooling and feature flags
