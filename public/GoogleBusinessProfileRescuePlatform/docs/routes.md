# Routes

## Existing Phase 1
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

## Added in Phase 2
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


## Phase 3 routes
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
