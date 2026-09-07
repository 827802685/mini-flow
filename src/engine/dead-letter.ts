// dead-letter: 死信队列 —— 重试耗尽后的兜底存储与自动重试
import type { Env } from '../types';
import { withRetry } from './retry';
import { parseWorkflowRow, type DqlRow, type WorkflowRow } from '../db/schema';

export interface DlqEntry {
  executionId: string;
  workflowId: string;
  nodeName: string;
  nodeType: string;
  nodeParameters?: unknown;
  lastInputData?: unknown;
  lastError?: string;
  maxRetries?: number;
}

// 投递死信
export function enqueueDeadLetter(env: Env, e: DlqEntry): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      `INSERT INTO dead_letter_queue
        (execution_id, workflow_id, node_name, node_type, node_parameters, last_input_data, last_error, max_retries, next_retry_at, status)
       VALUES (?,?,?,?,?,?,?,?, datetime('now','+5 minutes'),'pending')`,
    ).bind(
      e.executionId, e.workflowId, e.nodeName, e.nodeType,
      e.nodeParameters ? JSON.stringify(e.nodeParameters) : null,
      e.lastInputData ? JSON.stringify(e.lastInputData) : null,
      e.lastError ?? null,
      e.maxRetries ?? 5,
    ).run();
  });
}

// 列出待重试的死信（供手动界面 / cron）
export function listPending(
  env: Env,
  limit = 50,
): Promise<DqlRow[]> {
  return withRetry(async () => {
    const res = await env.DB.prepare(
      "SELECT * FROM dead_letter_queue WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= datetime('now')) ORDER BY created_at ASC LIMIT ?",
    ).bind(limit).all<DqlRow>();
    return res.results;
  });
}

// 手动把死信标记为待重试（用户点了"重试"）
export function requeueDeadLetter(env: Env, id: number): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      "UPDATE dead_letter_queue SET status='pending', next_retry_at=datetime('now'), retry_count=retry_count+1, updated_at=datetime('now') WHERE id=? AND status IN ('pending','failed')",
    ).bind(id).run();
  });
}

// 重试 sqlite increment（成功 handler 由调用方处理业务执行）
export function incrementDlqRetry(env: Env, id: number): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      "UPDATE dead_letter_queue SET retry_count=retry_count+1, status='retrying', updated_at=datetime('now') WHERE id=?",
    ).bind(id).run();
  });
}

export function resolveDeadLetter(env: Env, id: number): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      "UPDATE dead_letter_queue SET status='resolved', updated_at=datetime('now') WHERE id=?",
    ).bind(id).run();
  });
}

export function failDeadLetter(env: Env, id: number): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      "UPDATE dead_letter_queue SET status='failed', updated_at=datetime('now') WHERE id=?",
    ).bind(id).run();
  });
}

// 清理已解决 / 已失败很久的死信
export function purgeDeadLetter(env: Env, olderThanHours = 72): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();
  const res = env.DB.prepare(
    "DELETE FROM dead_letter_queue WHERE status IN ('resolved','failed') AND updated_at < ?",
  ).bind(cutoff).run();
  return res.then((r) => r.meta.changes);
}

// 从一条 DLQ 记录重建一次执行并重投给 FlowEngine。
// 用于 cron 自动补偿扫描 / 手动 retry。策略：从该工作流入口重跑（Phase 1 骨架），
// 携带 DLQ 记录的历史输入；真正的“从失败节点断点续跑”在 checkpoint 机制内已完成，
// DLQ 作为重试耗尽的保险兜底，重跑全流程是保守做法。
export async function rebuildFromDlq(
  env: Env,
  row: DqlRow,
): Promise<{ ok: boolean; newExecutionId?: string; error?: string }> {
  const wfRow = await withRetry(async () =>
    env.DB.prepare('SELECT * FROM workflows WHERE id=?').bind(row.workflow_id).first<WorkflowRow>(),
  );
  if (!wfRow) {
    await failDeadLetter(env, row.id).catch(() => {});
    return { ok: false, error: `workflow ${row.workflow_id} 不存在` };
  }
  // 重试次数已达上限 → 置 failed，转人工
  if (row.retry_count >= row.max_retries) {
    await failDeadLetter(env, row.id).catch(() => {});
    return { ok: false, error: `重试次数已达上限 ${row.max_retries}` };
  }

  const workflow = parseWorkflowRow(wfRow);
  const lastInput = (() => {
    try { return row.last_input_data ? JSON.parse(row.last_input_data) : {}; } catch { return {}; }
  })();
  const newExecutionId = crypto.randomUUID();

  // 先写后执行：建 execution → 标记 retrying → 提交 Workflows
  await withRetry(() => env.DB.prepare(
    "INSERT INTO executions (id, workflow_id, status, trigger_type, mode, input_data, started_at) VALUES (?,?,'pending','dlq','dlq',?,datetime('now'))",
  ).bind(newExecutionId, wfRow.id, JSON.stringify(lastInput)).run());
  await incrementDlqRetry(env, row.id).catch(() => {});

  await env.FLOW_ENGINE.create({
    id: newExecutionId,
    params: {
      workflowId: workflow.id as string,
      workflowName: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      executionId: newExecutionId,
      mode: 'dlq',
      input: lastInput,
      completedNodes: [], // 从入口重跑（精确断点重启目录在 checkpoint，DLQ 走全量重建）
    },
  }).catch(() => { /* Workflow 创建失败由 next cron 补偿 */ });

  await withRetry(() => env.DB.prepare("UPDATE executions SET status='running' WHERE id=?").bind(newExecutionId).run()).catch(() => {});
  return { ok: true, newExecutionId };
}