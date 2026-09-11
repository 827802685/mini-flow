// D1 表结构定义（对应 schema.sql，供代码内类型化引用）
// 避免魔法字符串散落各处。

import type { N8nWorkflow } from '../types';

// ---- 行类型 ----
export interface WorkflowRow {
  id: string;
  name: string;
  nodes: string; // JSON string of N8nNode[]
  connections: string; // JSON string of N8nConnections
  settings: string | null;
  active: number;
  archived: number | null;
  version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionRow {
  id: string;
  workflow_id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  trigger_type: string | null;
  mode: string | null;
  input_data: string | null;
  output_data: string | null;
  error_message: string | null;
  checkpoint: string | null;
  retry_count: number;
  max_retries: number;
  locked_at: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface NodeExecutionRow {
  id: string;
  execution_id: string;
  node_name: string;
  node_type: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  retry_attempt: number;
  input_data: string | null;
  output_data: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface DqlRow {
  id: number;
  execution_id: string;
  workflow_id: string;
  node_name: string;
  node_type: string;
  node_parameters: string | null;
  last_input_data: string | null;
  last_error: string | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  status: 'pending' | 'retrying' | 'failed' | 'resolved';
  created_at: string;
  updated_at: string;
}

// ---- 工作流序列化辅助 ----
export function parseWorkflowRow(row: WorkflowRow): N8nWorkflow {
  return {
    id: row.id,
    name: row.name,
    nodes: JSON.parse(row.nodes),
    connections: JSON.parse(row.connections),
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    active: row.active === 1,
    isArchived: row.archived === 1,
  } as N8nWorkflow;
}