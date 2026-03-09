-- Skyes Over London LC — Contractor Network schema (Neon Postgres)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contractor_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  full_name         text NOT NULL,
  business_name     text,
  email             text NOT NULL,
  phone             text,

  coverage          text,
  availability      text NOT NULL DEFAULT 'unknown',

  lanes             jsonb NOT NULL DEFAULT '[]'::jsonb,
  service_summary   text NOT NULL,
  proof_link        text,
  entity_type       text NOT NULL DEFAULT 'independent_contractor',
  licenses          text,

  status            text NOT NULL DEFAULT 'new',
  admin_notes       text NOT NULL DEFAULT '',
  tags              text[] NOT NULL DEFAULT ARRAY[]::text[],

  verified          boolean NOT NULL DEFAULT false,
  dispatched        boolean NOT NULL DEFAULT false,
  last_contacted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_contractor_submissions_created_at ON contractor_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contractor_submissions_status ON contractor_submissions (status);
CREATE INDEX IF NOT EXISTS idx_contractor_submissions_email ON contractor_submissions (email);
CREATE INDEX IF NOT EXISTS idx_contractor_submissions_lanes_gin ON contractor_submissions USING gin (lanes);
CREATE INDEX IF NOT EXISTS idx_contractor_submissions_tags_gin ON contractor_submissions USING gin (tags);

CREATE TABLE IF NOT EXISTS submission_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES contractor_submissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  blob_key      text NOT NULL,
  filename      text NOT NULL,
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  bytes         integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_submission_files_submission_id ON submission_files (submission_id);

CREATE TABLE IF NOT EXISTS admin_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL DEFAULT 'unknown',
  action      text NOT NULL,
  subject_id  uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit (created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contractor_submissions_updated_at ON contractor_submissions;
CREATE TRIGGER trg_contractor_submissions_updated_at
BEFORE UPDATE ON contractor_submissions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
