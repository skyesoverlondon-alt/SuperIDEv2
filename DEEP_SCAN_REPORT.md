# Deep Scan Report

Date: 2026-03-06
Repository: `SuperIDEv2`

## Scope and method

This scan covered:

- Repository structure and component surface mapping.
- Existing project quality/security/release scripts.
- Dependency vulnerability audit (`npm audit`).
- Basic secret-pattern search across tracked source files.

## Repository footprint

- TypeScript/TSX files: **75**
- Netlify function files: **58**
- Cloudflare worker source files: **10**
- Public app surfaces with `index.html`: **37**

## Automated checks executed

### Release checklist (composite)

Command: `npm run release:checklist`

Result: **PASS**

Highlights from generated checklist artifact:

- Blocking failures: `0`
- Build passed (`vite build`)
- Security/reliability/data-integrity/executive checks all passed

Reference artifacts generated/refreshed:

- `artifacts/release-checklist.json`
- `artifacts/release-artifacts.json`
- `artifacts/release-gates.json`

## Security/dependency findings

### 1) npm audit findings

Command: `npm audit --json`

Result: **2 moderate vulnerabilities** (transitive)

- `dompurify` vulnerable range: `>=3.1.3 <=3.3.1`
  - Advisory: GHSA-v2wj-7wpq-c8vv
  - Affects dependency tree via `monaco-editor`
- `monaco-editor`
  - Reported as affected due to the transitive `dompurify` issue

Suggested remediation:

- Run `npm audit fix` and verify resulting dependency graph + app behavior.
- If update cannot be safely auto-applied, pin/upgrade affected package versions manually and rerun release checklist.

### 2) Secret pattern sweep

Command:

```bash
rg -n "(AKIA|BEGIN PRIVATE KEY|ghp_|xoxb-|AIza|sk_live_|sk-[A-Za-z0-9]{20,})" --glob '!node_modules/**' --glob '!dist/**'
```

Result: **No matches found**.

## Reliability/CI observations

- Multiple npm commands emitted: `npm warn Unknown env config "http-proxy"`.
- This is not currently blocking checks, but should be cleaned from npm config/environment to reduce noise and future npm-major compatibility risk.

## Overall assessment

- **Current release-gate posture is green** using project-defined checks.
- **Primary risk item is dependency hygiene** (2 moderate transitive vulnerabilities).
- No obvious plaintext secret leakage detected by lightweight pattern scan.

## Recommended next steps

1. Apply dependency remediation (`npm audit fix` or targeted upgrades), then rerun `npm run release:checklist`.
2. Remove/rename deprecated npm environment configuration (`http-proxy`) in CI/dev environments.
3. Add this deep scan (or a reduced machine-readable variant) into CI on a scheduled cadence.

