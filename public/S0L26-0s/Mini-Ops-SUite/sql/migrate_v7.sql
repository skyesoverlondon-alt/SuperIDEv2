-- v7 migration: per-vault key revision tracking (supports per-vault key rotation)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sync_vault_keys' AND column_name='key_rev'
  ) THEN
    ALTER TABLE sync_vault_keys ADD COLUMN key_rev bigint NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Backfill (idempotent)
UPDATE sync_vault_keys SET key_rev = COALESCE(key_rev, 1);
