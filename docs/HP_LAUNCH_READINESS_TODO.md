# HP Launch Readiness TODO (SuperIDE + SkyeDocxPro)

## Objective

Ship a launch-ready, enterprise-defensible build with clear proof of security, reliability, and user operability.

## A. Product Capability (Doc Workflow)

- [x] Rich editing + quick find + find/replace.
- [x] Comments threads panel.
- [x] Suggestion mode + suggestion log.
- [x] Version timeline + restore operation.
- [x] Templates + metadata controls.
- [x] Page-break insertion for print/PDF structure.
- [x] `.skye` package export/import.
- [x] Optional encrypted `.skye` export (AES-GCM).
- [x] Recovery failsafe kit (recovery code path).
- [x] In-product encryption/recovery tutorial modal.

## B. User Education + Operational Safety

- [x] SuperIDE tutorial steps updated for encrypted export and recovery drill.
- [x] Encryption/failsafe runbook published (`DOCXPRO_ENCRYPTION_FAILSAFE_RUNBOOK.md`).
- [ ] Add short video/gif walkthrough for enablement (post-HP review optional).

## C. Security + Governance

- [x] Workspace RBAC on suite persistence APIs.
- [x] Optimistic concurrency (`updated_at`) guard with `409` handling.
- [x] Merge preview conflict flow in UI.
- [ ] Formal key rotation automation for encrypted artifacts.
- [ ] External pen test and remediation report.

## D. Reliability + Validation

- [x] Build compiles clean (`npm run build`).
- [x] Smoke semantics aligned with policy-protected endpoints.
- [ ] Capture fresh Supreme Smoke evidence bundle for HP packet.
- [ ] Add release candidate tag + changelog snapshot for meeting package.

## E. Enterprise Readiness (Immediate Next)

- [ ] Add admin-facing security posture dashboard tile.
- [ ] Add downloadable launch packet (runbook + smoke report + architecture summary).
- [ ] Add tenant-level backup/restore drill report template.

## Release Gate (HP Meeting)

Minimum go-forward criteria for tomorrow:

1. Build green and no diagnostics errors in touched files.
2. Encryption + recovery drill completed once and documented.
3. Smoke run captured with timestamp and policy-pass interpretation.
4. Tutorial + runbook links visible for operator onboarding.

## Notes

This checklist is designed for launch readiness, not full parity with all Word/Google Docs advanced features. Full parity remains a multi-phase roadmap beyond immediate HP integration scope.
