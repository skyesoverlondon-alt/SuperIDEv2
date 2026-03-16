# Security Model (SkyeSync)

SkyeSync is **end-to-end encrypted (E2EE)**: the server stores ciphertext and metadata only.

## Key hierarchy (wrapped-epoch-vault-v1)

1) Member device keys
- Each device has an **ECDH P‑256** keypair used to unwrap org epoch keys.
- Each device also has an **ECDSA P‑256** keypair used to sign login challenges.

2) Org Epoch Key (EDEK)
- Each org epoch has a symmetric key (AES‑GCM).
- The server stores that key as **ciphertext wraps per member** (one wrap per member, per epoch).
- Owners/admins grant access by uploading a wrap for a member.

3) Per-vault key (VDEK)
- Each vault has its own symmetric key (AES‑GCM).
- The server stores the vault key as ciphertext wrapped by the **epoch key**.
- Vault blobs are encrypted using the VDEK.

## Per-vault ACL (restricted vaults)

When a vault is `restricted=true`, only members with explicit grants can fetch the wrapped VDEK.

## Conflict handling

For non-locally-encrypted vault data, sync uses a deterministic merge strategy:
- LWW (last-write-wins) + tombstones (soft deletes)

If local vault encryption is enabled, auto-merge is disabled (conservative snapshot behavior).

## Per-vault key rotation (v7)

A per-vault key rotation generates a new VDEK and:
- updates the server-stored wrapped VDEK (`sync_vault_keys.wrap`)
- increments `sync_vault_keys.key_rev`
- re-encrypts and pushes **only that vault blob**

Vault envelopes include `vaultKeyRev`. Devices detect a higher revision and will re-fetch the wrapped VDEK automatically.

**Production hardening (v8):** the server enforces `vaultKeyRev` on push. A stale device cannot overwrite the canonical ciphertext with data encrypted under an old VDEK.

This is used for “strong revocation” when you want forward secrecy for specific vaults after removing a member.

## Limitations (honest)

- A revoked member cannot decrypt **future** updates after key rotation, but anything they already decrypted before revocation can’t be “unlearned.”
- If a device is offline and misses a key rotation, it may fail to decrypt a vault until it reconnects and refreshes the wrapped key.

