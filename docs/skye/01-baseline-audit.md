# SKYE-01 — Baseline Audit

## Objective
Correct the stale baseline in the source directive and establish the real inventory of `.skye` implementations currently in the repo.

## Required Reads
1. `DEVV ONLY NO GIT/Implementation Directive For .SKYE Files`
2. `package.json`
3. `DEVV ONLY NO GIT/What This Is`

## Target Files
- `src/App.tsx`
- `SkyeDocxPro/index.html`
- `SkyeBlog/index.html`
- `SovereignVariables/index.html`
- `public/SkyeMail/index.html`
- `public/SkyeChat/index.html`
- `package.json`

## Edit Directives
- Replace the assumption that only two `.skye` implementations exist.
- Produce a full live inventory of every known implementation.
- For each target file, record:
  - format name
  - marker handling
  - KDF and iteration count
  - plaintext payload shape
  - assets behavior
  - passphrase requirement
  - import validation strictness
  - legacy compatibility behavior
- Add a source ownership table distinguishing:
  - source-root files synced into `public/`
  - direct-public files edited in place
- Assign each target implementation to a later migration stage.

## Validation
- Confirm source-root ownership from `package.json` sync scripts.
- Ensure each implementation has a later-stage destination (`SKYE-04`, `SKYE-05`, or `SKYE-06`).

## Exit Criteria
- Every known live `.skye` implementation is listed.
- Every known drift point is documented.
- Every target surface is classified by ownership and migration stage.

## Known Blockers
- Additional hidden implementations may exist outside the currently known set and may need secondary discovery.

## Audit Outcome
Stage complete. The source directive baseline is stale: the repo currently has six live `.skye` logic owners, plus three synced `public/` deployment copies that should not be treated as primary edit targets.

## Source Ownership Map
`package.json` establishes the following source-of-truth rules:

| Primary source | Synced deployment copy | Ownership class | Evidence | Later stage |
| --- | --- | --- | --- | --- |
| `SkyeDocxPro/index.html` | `public/SkyeDocxPro/index.html` | source-root owner | `sync:docxpro` copies source root into `public/SkyeDocxPro` | `SKYE-05` |
| `SkyeBlog/index.html` | `public/SkyeBlog/index.html` | source-root owner | `sync:skyeblog` copies source root into `public/SkyeBlog` | `SKYE-05` |
| `SovereignVariables/index.html` | `public/SovereignVariables/index.html` | source-root owner | `sync:sovereign` copies source root into `public/SovereignVariables` | `SKYE-05` |
| `src/App.tsx` | n/a | shell owner | Vite shell source | `SKYE-04` |
| `public/SkyeMail/index.html` | n/a | direct-public owner | no sync script exists for SkyeMail | `SKYE-06` |
| `public/SkyeChat/index.html` | n/a | direct-public owner | no sync script exists for SkyeChat | `SKYE-06` |

## Live `.skye` Implementation Inventory

| Target file | Format and write path | Container and marker behavior | KDF / iterations | Plaintext payload shape | Assets / failsafe behavior | Passphrase and import behavior | Legacy behavior | Migration stage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `src/App.tsx` | Writes `skye-secure-v1`; reads `skye-secure-v1` and legacy `skye-v2` | Writes binary `SKYESEC1 + 0x00 + JSON`; secure reader accepts binary marker only | `PBKDF2-SHA256`, `150000` | Raw app-specific JSON only via `currentAppPayload()`; not wrapped in canonical `meta/state/assets` | No `assets` contract at envelope layer; no failsafe block | Export requires passphrase length >= 6; import requires passphrase for secure and legacy encrypted reads | Reads legacy textual `skye-v2` JSON with top-level `cipher` / `iv` / `salt`; blocks legacy unencrypted files | `SKYE-04` |
| `SkyeDocxPro/index.html` | Writes and reads `skye-secure-v1` | Writes binary `SKYESEC1 + 0x00 + JSON`; reader also accepts text payloads prefixed with `SKYESEC1\n` | `PBKDF2-SHA256`, `120000` | `{ meta, content, assets }`; content lives outside canonical `state` wrapper | Asset export included; optional `failsafe` encrypted block supported | Export hard-requires passphrase; reader validates format + alg + kdf + iterations + encrypted blocks | No `skye-v2` support; tolerant read for older `SKYESEC1\n` text wrapper | `SKYE-05` |
| `SkyeBlog/index.html` | Writes and reads `skye-secure-v1` | Same binary writer and tolerant binary-or-text reader as DocxPro | `PBKDF2-SHA256`, `120000` | `{ meta, content, assets }`; mirrors DocxPro document-centric shape | Asset export included; optional `failsafe` encrypted block supported | Export hard-requires passphrase; reader validates format + alg + kdf + iterations + encrypted blocks | No `skye-v2` support; tolerant read for older `SKYESEC1\n` text wrapper | `SKYE-05` |
| `SovereignVariables/index.html` | Writes and reads `skye-secure-v1` | Writes binary `SKYESEC1 + 0x00 + JSON`; reader requires binary marker | `PBKDF2-SHA256`, `120000` | Export payload is `{ meta, state }`; envelope also adds a second top-level `meta` block | No asset array; no failsafe block | Export requires prompted passphrase length >= 6; import prompts for passphrase and restores full app state | No legacy support; import validation is weak because it checks marker and `payload.primary`, then trusts decrypted `state.projects` | `SKYE-05` |
| `public/SkyeMail/index.html` | Writes and reads `skye-secure-v1` | Writes binary `SKYESEC1 + 0x00 + JSON`; strict binary marker reader | `PBKDF2-SHA256`, `120000` | Canonical-aligned `{ meta, state, assets }`; `meta.app_id = SkyeMail` and `schema_version = 1` | `assets: []`; no failsafe block | Export requires passphrase length >= 6; reader validates envelope metadata strictly and payload app compatibility on import | No legacy support | `SKYE-06` |
| `public/SkyeChat/index.html` | Writes and reads `skye-secure-v1` | Writes binary `SKYESEC1 + 0x00 + JSON`; strict binary marker reader | `PBKDF2-SHA256`, `120000` | Canonical-aligned `{ meta, state, assets }`; `meta.app_id = SkyeChat` and `schema_version = 1` | `assets: []`; no failsafe block | Export requires passphrase length >= 6; reader validates envelope metadata strictly and payload app compatibility on import | No legacy support | `SKYE-06` |

## Per-Implementation Notes

### `src/App.tsx`
- The shell is the only implementation still carrying the old `skye-v2` reader.
- The shell secure format is structurally different from the policy target because it stores `app`, `ws_id`, and `exported_at` at the envelope layer and writes only raw app payload JSON inside the cipher text.
- The shell is also the only current implementation using `150000` iterations instead of `120000`.

### `SkyeDocxPro/index.html`
- DocxPro is the closest secure implementation to the source directive on binary container behavior.
- It is still non-canonical because the plaintext payload is document-specific (`content`) rather than `meta/state/assets` and because it does not carry `meta.app_id` inside the decrypted payload.
- It is additionally protected by `docs/protected-apps-manifest.json`, so migration cannot be treated like ordinary surface work.

### `SkyeBlog/index.html`
- SkyeBlog duplicates the DocxPro crypto path almost verbatim.
- This duplication is one of the clearest justifications for the future shared runtime extraction.

### `SovereignVariables/index.html`
- SovereignVariables partially converged on the canonical payload shape by including `meta.app_id` and `workspace_id`, but it splits metadata between the encrypted payload and the outer envelope.
- Its import validation is the weakest of the audited standalone implementations.

### `public/SkyeMail/index.html` and `public/SkyeChat/index.html`
- These two are currently the best examples of the intended plaintext payload shape because they already use `meta`, `state`, and `assets`.
- They still diverge from the policy contract by omitting optional failsafe support and by leaving app identity out of the secure envelope.

## Cross-Repo Drift Summary
1. **Iteration count drift**
  - `src/App.tsx` uses `150000`.
  - All other audited secure implementations use `120000`.
2. **Envelope metadata drift**
  - Shell writes top-level `app`, `ws_id`, and `exported_at`.
  - SovereignVariables writes a top-level `meta` object.
  - DocxPro, SkyeBlog, SkyeMail, and SkyeChat rely on decrypted payload metadata instead.
3. **Plaintext payload drift**
  - Shell writes raw app payload JSON.
  - DocxPro and SkyeBlog write `{ meta, content, assets }`.
  - SovereignVariables writes `{ meta, state }`.
  - SkyeMail and SkyeChat write `{ meta, state, assets }` and are closest to target.
4. **Marker read drift**
  - Shell, SovereignVariables, SkyeMail, and SkyeChat accept binary marker only.
  - DocxPro and SkyeBlog also accept older text files starting with `SKYESEC1\n`.
5. **Legacy-read drift**
  - Only the shell reads `skye-v2`.
  - All standalone surfaces are effectively secure-only, but with different validation strictness.
6. **Failsafe drift**
  - Only DocxPro and SkyeBlog support optional `failsafe` encrypted blocks.
7. **Validation strictness drift**
  - SkyeMail and SkyeChat enforce envelope metadata plus `meta.app_id` and `schema_version`.
  - DocxPro and SkyeBlog enforce envelope metadata and encrypted-block shape but not canonical app metadata.
  - SovereignVariables checks marker and payload presence, then trusts decrypted state.
  - Shell enforces its own secure envelope shape but not canonical `meta/state/assets` semantics.

## Additional Discovery Notes
- Search did not reveal any additional unique `.skye` logic owners beyond the six files above.
- `public/SkyeDocxPro/index.html`, `public/SkyeBlog/index.html`, and `public/SovereignVariables/index.html` are synced deployment copies and should not be counted as separate primary implementations.
- The baseline claim in the original directive that only two implementations exist is no longer accurate.

## Next Stage
`SKYE-02`

## Target Matrix
| Target file | Current state | Required change | Dependency | Validation | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/App.tsx` | Secure plus legacy reader, non-canonical payload, `150000` iterations | migrate shell to canonical plaintext payload and shared runtime | none | audit recorded | done | assigned to `SKYE-04` |
| `SkyeDocxPro/index.html` | Secure source-root implementation with failsafe and protected status | migrate through protected-aware source-root path | none | audit recorded | done | assigned to `SKYE-05` |
| `SkyeBlog/index.html` | Secure source-root implementation mirroring DocxPro | migrate via shared runtime extraction | none | audit recorded | done | assigned to `SKYE-05` |
| `SovereignVariables/index.html` | Secure source-root implementation with weak import validation | migrate via shared runtime and stronger validation | none | audit recorded | done | assigned to `SKYE-05` |
| `public/SkyeMail/index.html` | Direct-public implementation closest to canonical plaintext shape | migrate direct-public surface to shared runtime | none | audit recorded | done | assigned to `SKYE-06` |
| `public/SkyeChat/index.html` | Direct-public implementation closest to canonical plaintext shape | migrate direct-public surface to shared runtime | none | audit recorded | done | assigned to `SKYE-06` |
| `package.json` | Sync script source of truth confirmed | keep ownership map authoritative for later migrations | none | ownership table recorded | done | source-root ownership resolved |
