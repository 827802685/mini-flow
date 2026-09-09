CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'team',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO projects (id, name, type) VALUES ('personal', 'Personal', 'personal')
  ON CONFLICT(id) DO NOTHING;
ALTER TABLE workflows ADD COLUMN project_id TEXT;