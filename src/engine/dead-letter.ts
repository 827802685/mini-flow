// dead-letter: 死信队列 —— 重试耗尽后的兜底存储与自动重试
import type { Env } from '../types';
import { withRetry } from './retry';
import type { DqlRow } from '../db/schema';

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