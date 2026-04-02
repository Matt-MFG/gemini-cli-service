-- Phase 2: App groups and conversation linking (P2-W6, F2-23 through F2-28)

-- Add group and conversation fields to apps table
ALTER TABLE apps ADD COLUMN group_name TEXT DEFAULT NULL;
ALTER TABLE apps ADD COLUMN conversation_id TEXT DEFAULT NULL;
ALTER TABLE apps ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- App groups table for custom organization (F2-24)
CREATE TABLE IF NOT EXISTS app_groups (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_app_groups_user ON app_groups(user_id);

-- Skill usage tracking for reflection loop (P2-W8, F2-35)
CREATE TABLE IF NOT EXISTS skill_usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  skill_name   TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT (datetime('now')),
  success      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_skill_usage_user ON skill_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_usage_name ON skill_usage(skill_name);

-- Tool effectiveness tracking for reflection (F2-35)
CREATE TABLE IF NOT EXISTS tool_effectiveness (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  call_count   INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_tool_eff_user ON tool_effectiveness(user_id);
