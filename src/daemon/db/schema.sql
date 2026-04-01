-- App registry schema (D-10)
-- Stores metadata about running/stopped applications.
-- Survives daemon restarts; reconciled with Docker state on startup.

CREATE TABLE IF NOT EXISTS apps (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  image         TEXT NOT NULL DEFAULT 'node:22-alpine',
  internal_port INTEGER NOT NULL DEFAULT 3000,
  url           TEXT,
  container_id  TEXT,
  status        TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','running','stopped','error')),
  start_command TEXT,
  env_json      TEXT DEFAULT '{}',
  volume_names  TEXT DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_apps_user ON apps(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_status ON apps(status);

-- Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cached_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_conversation ON token_usage(conversation_id);

-- Audit log for tool executions (F-32)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  tool_name   TEXT NOT NULL,
  args_json   TEXT,
  result_json TEXT,
  logged_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logged ON audit_log(logged_at);
