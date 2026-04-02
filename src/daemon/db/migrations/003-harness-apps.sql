-- Phase 3: Harness app tracking
-- Tracks which catalog apps are installed, their resolved config,
-- and SSO client state.

CREATE TABLE IF NOT EXISTS harness_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  category TEXT,
  image TEXT NOT NULL,
  status TEXT DEFAULT 'installing',  -- installing, running, stopped, error
  container_id TEXT,
  container_name TEXT,
  port INTEGER,
  url TEXT,
  env_json TEXT,                     -- resolved env vars (encrypted in production)
  sso_client_id TEXT,
  sso_client_secret TEXT,
  harness_requires TEXT,             -- JSON array of required services
  installed_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_health_check TEXT,
  health_status TEXT DEFAULT 'unknown'
);

-- Resource usage tracking per harness app
CREATE TABLE IF NOT EXISTS harness_resource_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  cpu_percent REAL,
  memory_mb REAL,
  disk_mb REAL,
  recorded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (app_name) REFERENCES harness_apps(name)
);

CREATE INDEX IF NOT EXISTS idx_harness_apps_status ON harness_apps(status);
CREATE INDEX IF NOT EXISTS idx_harness_resource_app ON harness_resource_usage(app_name, recorded_at);
