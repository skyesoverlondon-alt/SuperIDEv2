# Enterprise Device Readiness (Apple / HP / Channel)

This document is the executive + technical readiness pack for large-scale device onboarding.

## Positioning

Skye/KaixU is architected as a secure, policy-gated AI platform:

- Client surfaces are replaceable.
- Netlify functions are policy and auth gate.
- Cloudflare Worker is execution brain.
- Security controls (token lock/scope/TTL, SKNore) enforce enterprise boundaries.

## Procurement Narrative (What Decision-Makers Need)

- Security-by-default architecture with explicit policy gates.
- Auditable trails for critical actions.
- Controlled machine access with expiring scoped tokens.
- Deployment model compatible with managed enterprise environments.

## Technical Evaluation Checklist

- [ ] Confirm SSO strategy and identity provider integration path.
- [ ] Confirm endpoint allow-list and egress controls.
- [ ] Confirm device baseline (OS versions, browser policy, TLS inspection exceptions).
- [ ] Confirm support model and escalation contacts.
- [ ] Confirm legal/compliance package (DPA, retention policy, breach notification process).

## Device Rollout Baseline

### Recommended Baseline

- CPU: modern 4+ core.
- RAM: 16 GB recommended (8 GB minimum for light workloads).
- Storage: 256 GB SSD minimum.
- Network: stable enterprise Wi-Fi with HTTPS egress to Netlify/Cloudflare/provider APIs.

### OS Support Targets

- macOS (managed + unmanaged modes).
- Windows 11 enterprise images.
- Chromebook/browser mode for constrained deployments.

## Deployment Models

- Browser-first deployment for fastest pilot.
- Managed profile deployment via MDM (Jamf/Intune) for enterprise control.
- Controlled token issuance for kiosk/shared workflows.

## Pilot Plan (30-60-90)

### Day 0-30

- Security review + architecture walkthrough.
- Pilot with controlled user group.
- Daily Supreme Smoke and evidence collection.

### Day 31-60

- Expand to multi-team users.
- Validate support workflows and SLA compliance.
- Complete hardening P0/P1 checklist items.

### Day 61-90

- Execute staged production rollout.
- Final procurement sign-off package.
- Quarterly governance review cadence established.

## Materials to Hand to Apple/HP/Reseller Teams

- Architecture diagram + Skye Standard summary.
- Hardening backlog status report.
- Supreme smoke evidence package.
- Security controls mapping (token, SKNore, audit, access policy).
- Support/SLA commitments and escalation matrix.
