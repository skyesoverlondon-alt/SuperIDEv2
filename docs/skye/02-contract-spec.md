# SKYE-02 — Canonical Contract Spec

## Objective
Freeze the canonical `.skye` secure write contract and explicitly scope legacy-read support.

## Required Reads
1. `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files`
2. `docs/skye-schema-fixture.json`
3. `docs/export-import-fixtures.json`
4. `docs/skye/01-baseline-audit.md`

## Target Files
- `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files`
- `docs/skye-schema-fixture.json`
- `docs/export-import-fixtures.json`
- Reference implementations in current surfaces

## Edit Directives
- Lock secure write format to `skye-secure-v1`.
- Define accepted binary container rules:
  - marker `SKYESEC1`
  - `0x00` delimiter
  - UTF-8 JSON envelope payload
- Define accepted secure envelope fields and required values.
- Define explicit reject conditions:
  - wrong marker
  - wrong delimiter
  - malformed JSON
  - wrong `format`
  - wrong `alg`
  - wrong `kdf`
  - wrong `iterations`
  - missing required crypto fields
- Define plaintext payload expectations for `meta`, `state`, and `assets`.
- Define compatibility rules using `meta.app_id`.
- Define exact legacy-read policy for old `skye-v2` payloads.

## Validation
- One secure write contract only.
- Compatibility matrix written.
- Legacy-read behavior is narrow and explicit.

## Exit Criteria
- Canonical write spec is unambiguous.
- Legacy-read behavior is defined, not implied.
- App compatibility rules are written per class.

## Known Blockers
- Baseline drift may reveal payload shapes that need temporary compatibility mapping.

## Contract Decision
Stage complete. Canonical write format is fixed to the policy contract from `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files`, with temporary read compatibility only where required to migrate audited legacy behavior.

## Canonical Secure Write Contract

### 1. Binary container
Every canonical `.skye` write must use this exact byte layout:

1. ASCII marker `SKYESEC1`
2. one null delimiter byte `0x00`
3. UTF-8 JSON body containing the secure envelope

Writers must not emit the older text-prefixed `SKYESEC1\n` variant.

### 2. Canonical secure envelope
Canonical writers must emit the following required fields and values:

```json
{
  "format": "skye-secure-v1",
  "encrypted": true,
  "alg": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "iterations": 120000,
  "exportedAt": "ISO-8601",
  "hint": "optional non-secret hint",
  "payload": {
    "primary": { "cipher": "...", "iv": "...", "salt": "..." },
    "failsafe": { "cipher": "...", "iv": "...", "salt": "..." }
  }
}
```

Required rules:
- `format` must equal `skye-secure-v1`
- `encrypted` must equal `true`
- `alg` must equal `AES-256-GCM`
- `kdf` must equal `PBKDF2-SHA256`
- `iterations` must equal `120000`
- `payload.primary` must exist and be a valid encrypted block
- `payload.failsafe` is optional and must be a valid encrypted block when present
- `hint` is optional and must never contain the passphrase itself

Write-time restrictions:
- canonical writers must not emit top-level `app`, `ws_id`, or envelope-level `meta`
- app identity belongs in decrypted payload `meta.app_id`
- workspace identity belongs in decrypted payload `meta.workspace_id`

Read-time tolerance during migration:
- canonical readers may ignore additive unknown fields while migration is in progress
- additive fields must not override or contradict required canonical fields

### 3. Canonical plaintext payload
Canonical writers must encrypt a JSON payload shaped as:

```json
{
  "meta": {
    "app_id": "SkyeMail",
    "app_version": "1.0.0",
    "workspace_id": "primary-workspace",
    "document_id": "optional",
    "title": "Human title",
    "owner": "user@org.com",
    "created_at": "ISO-8601",
    "updated_at": "ISO-8601",
    "tags": ["optional"],
    "schema_version": 1
  },
  "state": {},
  "assets": [
    {
      "id": "asset-id",
      "name": "file.png",
      "mime": "image/png",
      "data_base64": "..."
    }
  ]
}
```

Rules:
- `meta.app_id` is mandatory for all canonical payloads
- `meta.schema_version` is mandatory and numeric
- `state` is mandatory and app-specific
- `assets` is optional, but when present it must use `mime` and `data_base64`
- document-oriented apps must map content into `state`, not a top-level `content` sibling

## Explicit Reject Conditions
Readers must reject the file when any of the following is true:

1. marker is missing or not exactly `SKYESEC1`
2. delimiter is missing or not `0x00`
3. JSON body cannot be parsed
4. `format !== "skye-secure-v1"`
5. `encrypted !== true`
6. `alg !== "AES-256-GCM"`
7. `kdf !== "PBKDF2-SHA256"`
8. `iterations !== 120000` for canonical reads
9. `payload.primary` is missing or malformed
10. decrypt fails with provided passphrase
11. decrypted payload is missing `meta.app_id`, `meta.schema_version`, or `state`
12. decrypted payload targets a different app and no approved translator exists

## Compatibility Policy

### Required self-import
Every app must import its own canonical `meta.app_id` payload.

### Cross-app import
Cross-app import is not universal by default.

| App class | Current rule |
| --- | --- |
| Shell and orchestration surfaces | May read legacy formats during migration only |
| Document-class mega apps (`SkyeDocxPro`, `SkyeBlog`) | Self-import required; cross-app import blocked until explicit translators exist |
| Platform communication apps (`SkyeMail`, `SkyeChat`) | Self-import required; cross-app import blocked for now |
| Structured state apps (`SovereignVariables`) | Self-import required; cross-app import blocked unless translator maps `state` safely |

### Legacy-read scope
Temporary legacy support is limited to audited migration needs:

| Legacy input | Temporary policy |
| --- | --- |
| Shell `skye-v2` JSON | Allowed only as a migration adapter during shell rollout |
| Text-prefixed `SKYESEC1\n` secure files | Allowed only as a migration adapter for DocxPro and SkyeBlog families |
| Legacy unencrypted `.skye` | always reject |

Legacy write is not allowed for any new work.

## Mapping Current Implementations To Canonical Contract

| Current implementation | Canonical gap | Required normalization |
| --- | --- | --- |
| `src/App.tsx` | wrong iteration count, wrong envelope metadata, wrong plaintext shape | move app identity and workspace identity into decrypted `meta`; wrap raw payload into `state`; standardize to `120000` |
| `SkyeDocxPro/index.html` | document `content` is top-level plaintext field | move content into `state`; add canonical `meta.app_id`; keep optional failsafe |
| `SkyeBlog/index.html` | same gap set as DocxPro | same normalization path as DocxPro |
| `SovereignVariables/index.html` | duplicated envelope-level `meta`, weak import validation | move all app metadata into plaintext `meta`; strengthen envelope and payload checks |
| `public/SkyeMail/index.html` | mostly canonical already, but no failsafe and envelope omits canonicalized migration handling | keep plaintext shape; adopt shared validator/runtime |
| `public/SkyeChat/index.html` | mostly canonical already, but no failsafe and envelope omits canonicalized migration handling | keep plaintext shape; adopt shared validator/runtime |

## Fixture Implications
- `docs/skye-schema-fixture.json` should remain the plaintext reference payload, not the secure binary golden file.
- `docs/export-import-fixtures.json` must later be expanded with fixture labels for canonical secure envelope, wrong-marker, wrong-iteration, wrong-app, tampered cipher text, and approved legacy adapters.
- Real binary golden files belong to `SKYE-08`, not this stage.

## Next Stage
`SKYE-03`

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files` | policy source exists | align stage spec to policy source | SKYE-01 | canonical contract summary | done | policy preserved; execution spec now frozen here |
| `docs/skye-schema-fixture.json` | plaintext fixture only | map against canonical payload rules | SKYE-01 | fixture alignment notes | done | remains plaintext reference fixture |
| `docs/export-import-fixtures.json` | existing fixture set | classify fixture coverage gaps | SKYE-01 | coverage notes | done | secure golden vectors deferred to `SKYE-08` |
| `src/App.tsx` | current implementation drift | reference for compatibility rules | SKYE-01 | contract matrix entry | done | normalization requirements recorded |
| `SkyeDocxPro/index.html` | current secure implementation | reference for secure container rules | SKYE-01 | contract matrix entry | done | DocxPro migration constraints recorded |
