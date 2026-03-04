# SkyeDocxPro Encryption + Failsafe Runbook

## Goal

Provide an operator-safe flow so teams can:

1. Encrypt `.skye` files with a passphrase.
2. Configure a recovery fallback if passphrase custody fails.
3. Recover files without data loss.

## Standard User Procedure

1. Open `SkyeDocxPro` and select `Save As...`.
2. Choose `Skye Document (.skye)`.
3. Enable `Encrypt .skye package with passphrase`.
4. Enter a strong passphrase (12+ chars, mixed classes).
5. Add a non-sensitive `Passphrase hint` (never include actual secret fragments).
6. Enable `Generate Recovery Failsafe Kit`.
7. Save the `.skye` export.
8. In the `Recovery Failsafe Kit` modal:
   - Download the generated `.recovery.json` file.
   - Copy/store the recovery code in your secrets manager.

## Custody Policy (Required)

- Store passphrase and recovery kit in separate systems.
- Never keep both in the same folder, ticket, or chat thread.
- Rotate passphrase + recovery kit quarterly for active projects.
- Re-export critical docs after every rotation.

## Recovery Procedure (Forgotten Passphrase)

1. Open encrypted `.skye` file.
2. Enter passphrase when prompted.
3. If passphrase fails and failsafe is present:
   - Enter recovery code from the downloaded recovery kit.
4. File opens and restores:
   - Document content
   - Embedded assets
   - Comments/suggestions/version snapshots
   - Metadata

## Drill Procedure (for Readiness)

Run this once per release candidate:

1. Export encrypted `.skye` with failsafe enabled.
2. Close app and re-open import flow.
3. Intentionally enter wrong passphrase.
4. Complete unlock with recovery code.
5. Confirm content hash/word count and timeline entries are intact.

## Failure Modes + Actions

- **No passphrase and no recovery code**: file is unrecoverable by design.
- **Recovery kit missing**: use passphrase-only unlock path.
- **Wrong recovery code**: verify code format and vault source.
- **Suspected compromise**: rotate keys and re-export immediately.

## HP Meeting Talking Points

- AES-GCM encrypted package format for portable files.
- Operator-level recovery path with explicit custody separation.
- Built-in user guidance (`Encryption & Recovery Guide`) in-product.
- Repeatable drill workflow for release readiness evidence.
