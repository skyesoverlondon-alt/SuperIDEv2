# Diagnostics Redaction Policy

Date: 2026-03-05
Scope: All exported diagnostics, telemetry snapshots, and support bundles.

## Redaction Rules

Sensitive fields must be redacted before export when key names include:
- `token`
- `authorization`
- `password`
- `secret`
- `api_key`
- `access_key`
- `session`

## Email Handling

Fields containing email addresses should be masked unless explicitly required for support routing.
Mask format:
- `jane.doe@company.com` -> `j***@c***`

## Workspace and User Identifiers

- Keep identifiers required for traceability.
- Do not include raw session identifiers.
- Avoid exporting full bearer values or credential-like content.

## Required Behavior

- Redaction runs before JSON serialization and download.
- Redacted exports remain structurally valid for tooling.
- Redaction should be deterministic for repeated exports.

## Validation

- CI policy checks should verify no sensitive key values appear in known diagnostic artifact paths.
- Manual spot-check required for first export after policy updates.
