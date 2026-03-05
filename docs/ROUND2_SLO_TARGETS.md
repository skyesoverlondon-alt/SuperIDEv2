# Round 2 SLO Targets

Date: 2026-03-05
Scope: SuperIDEv2 app classes

## App Class SLOs

### Interactive Apps
- Availability SLO: `99.9%` monthly
- p95 action latency SLO: `< 400ms` for local UI actions
- Error-rate SLO: `< 0.5%` user actions resulting in unhandled error

### AI Gateway Apps
- Availability SLO: `99.5%` monthly
- p95 gateway roundtrip latency SLO: `< 4.0s`
- Successful generation SLO: `>= 98%` non-empty valid response payloads

### Export/Artifact Apps
- Availability SLO: `99.7%` monthly
- p95 export initiation latency SLO: `< 1.5s`
- Export completion SLO: `>= 99%` successful artifact completion without corruption

### Admin/Governance Apps
- Availability SLO: `99.9%` monthly
- p95 write-action latency SLO: `< 1.0s`
- Audit write success SLO: `>= 99.99%` for critical governance events

## Error Budget Policy

- Monthly error budget breach threshold: `>= 100%` consumed before month end.
- Breach response:
  - Freeze non-critical feature releases.
  - Require reliability-focused remediation sprint.
  - Re-run smoke and policy gates before reopening release lane.

## Measurement Notes

- Availability measured at endpoint/action level from synthetic and real-user probes.
- Latency measured at p50/p95/p99; p95 used as release gate reference.
- Error rates include network, auth, validation, and runtime exceptions.
- All measurements are reported by app ID and workspace context where available.
