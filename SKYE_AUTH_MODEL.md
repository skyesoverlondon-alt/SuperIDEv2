# Skye Shared Auth Model

## Goals

- One identity/session model for all Skye apps.
- Role-based access control (RBAC) enforced consistently.
- Audit-friendly permission checks for every write action.

## Identity

- Principal: `user` (email + org membership).
- Session: short-lived access token + server-side session record.
- Scope: all app requests carry `org_id`, `user_id`, and `role` context.

## Roles

- `owner`: full org and billing control.
- `admin`: user/admin controls without billing owner-only actions.
- `member`: normal edit/use permissions inside assigned workspaces.
- `viewer`: read-only access.

## Permission Matrix (Core)

- Workspace create/update/delete: `owner`, `admin`, `member` (delete restricted to `owner`/`admin`).
- App configuration changes: `owner`, `admin`.
- App content writes: `owner`, `admin`, `member`.
- Read-only surfaces/exports: all roles (subject to workspace membership).

## Enforcement

- Netlify functions validate session and attach auth context.
- Worker endpoints validate signed caller identity and role.
- DB writes include audit event rows with actor, target, and action.

## App-Specific Notes

- SkyeVault secret-value reads limited to `owner`/`admin` unless explicitly delegated.
- SkyeAdmin mutations limited to `owner`/`admin`.
- SkyeAnalytics admin metrics can be restricted to `owner`/`admin`.
