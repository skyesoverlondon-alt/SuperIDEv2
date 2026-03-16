CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  brand_name TEXT NOT NULL,
  logo_url TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'America/Phoenix',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT,
  project_name TEXT,
  task_type TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  tags_json TEXT,
  status TEXT NOT NULL DEFAULT 'complete',
  device_id TEXT,
  record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  tags_json TEXT,
  linked_time_entry_id TEXT,
  occurred_at INTEGER NOT NULL,
  record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'log',
  title TEXT NOT NULL,
  body TEXT,
  occurred_at INTEGER NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  vendor TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT,
  occurred_at INTEGER NOT NULL,
  notes TEXT,
  receipt_object_key TEXT,
  receipt_sha256 TEXT,
  record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload_json TEXT,
  prev_hash TEXT,
  chain_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'pdf',
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  pdf_object_key TEXT,
  pdf_sha256 TEXT,
  manifest_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_workspace_started ON time_entries(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_occurred ON notes(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_workspace_occurred ON activity_logs(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_workspace_occurred ON expenses(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_occurred ON audit_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_workspace_created ON exports(workspace_id, created_at DESC);

INSERT OR IGNORE INTO workspaces (id, slug, brand_name, logo_url, currency, timezone)
VALUES ('ws_default', 'default', 'SkyeTime: Hour Logger', '/assets/img/skye-logo.png', 'USD', 'America/Phoenix');
