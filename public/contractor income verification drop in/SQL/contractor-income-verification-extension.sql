-- Contractor Income Verification extension
-- Run this AFTER the base Contractor Network schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contractor_income_entries (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_submission_id   uuid NOT NULL REFERENCES contractor_submissions(id) ON DELETE CASCADE,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  entry_date                 date NOT NULL,
  source_name                text NOT NULL,
  source_type                text NOT NULL DEFAULT 'manual',
  reference_code             text,
  gross_amount               numeric(12,2) NOT NULL DEFAULT 0,
  fee_amount                 numeric(12,2) NOT NULL DEFAULT 0,
  net_amount                 numeric(12,2) NOT NULL DEFAULT 0,
  category                   text NOT NULL DEFAULT 'general',
  notes                      text NOT NULL DEFAULT '',
  proof_url                  text,
  verification_status        text NOT NULL DEFAULT 'unreviewed',
  verification_notes         text NOT NULL DEFAULT '',
  created_by                 text NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS contractor_expense_entries (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_submission_id   uuid NOT NULL REFERENCES contractor_submissions(id) ON DELETE CASCADE,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  entry_date                 date NOT NULL,
  vendor_name                text NOT NULL,
  category                   text NOT NULL DEFAULT 'general',
  amount                     numeric(12,2) NOT NULL DEFAULT 0,
  deductible_percent         numeric(5,2) NOT NULL DEFAULT 100,
  notes                      text NOT NULL DEFAULT '',
  proof_url                  text,
  verification_status        text NOT NULL DEFAULT 'unreviewed',
  verification_notes         text NOT NULL DEFAULT '',
  created_by                 text NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS contractor_verification_packets (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_submission_id   uuid NOT NULL REFERENCES contractor_submissions(id) ON DELETE CASCADE,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  period_start               date NOT NULL,
  period_end                 date NOT NULL,
  status                     text NOT NULL DEFAULT 'draft',
  verification_tier          text NOT NULL DEFAULT 'company_verified',
  issued_by_name             text NOT NULL DEFAULT 'Skyes Over London',
  issued_by_title            text NOT NULL DEFAULT 'Chief Executive Officer',
  company_name               text NOT NULL DEFAULT 'Skyes Over London',
  company_email              text NOT NULL DEFAULT 'SkyesOverLondonLC@solenterprises.org',
  company_phone              text NOT NULL DEFAULT '4804695416',
  statement_text             text NOT NULL DEFAULT '',
  packet_notes               text NOT NULL DEFAULT '',
  packet_hash                text,
  UNIQUE(contractor_submission_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_contractor_income_entries_submission ON contractor_income_entries(contractor_submission_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_contractor_expense_entries_submission ON contractor_expense_entries(contractor_submission_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_contractor_verification_packets_submission ON contractor_verification_packets(contractor_submission_id, period_start DESC, period_end DESC);

CREATE OR REPLACE FUNCTION set_updated_at_contractor_income_entries()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contractor_income_entries_updated_at ON contractor_income_entries;
CREATE TRIGGER trg_contractor_income_entries_updated_at
BEFORE UPDATE ON contractor_income_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_contractor_income_entries();

CREATE OR REPLACE FUNCTION set_updated_at_contractor_expense_entries()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contractor_expense_entries_updated_at ON contractor_expense_entries;
CREATE TRIGGER trg_contractor_expense_entries_updated_at
BEFORE UPDATE ON contractor_expense_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_contractor_expense_entries();

CREATE OR REPLACE FUNCTION set_updated_at_contractor_verification_packets()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contractor_verification_packets_updated_at ON contractor_verification_packets;
CREATE TRIGGER trg_contractor_verification_packets_updated_at
BEFORE UPDATE ON contractor_verification_packets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_contractor_verification_packets();
