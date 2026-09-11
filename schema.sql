-- ============================================================
-- mini-flow D1 Schema
-- 存储 n8n 原生 workflow JSON + 防丢失/中断恢复扩展表
-- ============================================================

-- 工作流定义（nodes/connections 存 n8n 原生格式）
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  nodes TEXT NOT NULL,               -- JSON: n8n 节点数组
  connections TEXT NOT NULL,         -- JSON: n8n connections 形态
  settings TEXT,                     -- JSON: 画布设置等
  active INTEGER NOT NULL DEFAULT 0,
  version_id TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 执行记录（含恢复机制扩展列）
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | paused | completed | failed | cancelled
  trigger_type TEXT,
  mode TEXT,                            -- 与 n8n executionMode 对齐: manual | webhook | cron | trigger
  input_data TEXT,
  output_data TEXT,
  error_message TEXT,
  -- 恢复机制字段
  checkpoint TEXT,                     -- JSON: 断点续跑数据
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  locked_at TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

-- 节点执行日志（含重试计数）
CREATE TABLE IF NOT EXISTS node_executions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  execution_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | failed | skipped
  retry_attempt INTEGER NOT NULL DEFAULT 0,
  input_data TEXT,
  output_data TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- 死信队列
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_parameters TEXT,                -- JSON
  last_input_data TEXT,                -- JSON
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | retrying | failed | resolved
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id)
);

-- 实例变量（Variables）：跨工作流复用的键值对（$vars.MY_VAR）
CREATE TABLE IF NOT EXISTS variables (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  key TEXT NOT NULL UNIQUE,
  value TEXT,                      -- JSON 编码的值
  type TEXT NOT NULL DEFAULT 'string',  -- string | number | boolean | object | array | null
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 项目（Projects / teams）：单机. 预留团队项目
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'team',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO projects (id, name, type) VALUES ('personal', 'Personal', 'personal')
  ON CONFLICT(id) DO NOTHING;

-- 索引
CREATE INDEX IF NOT EXISTS idx_executions_locked_at ON executions(locked_at);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_dlq_next_retry ON dead_letter_queue(next_retry_at, status);
CREATE INDEX IF NOT EXISTS idx_node_exec_exec ON node_executions(execution_id);