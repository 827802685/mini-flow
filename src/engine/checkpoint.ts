// checkpoint: 节点级检查点读写与恢复
// 原则：每个节点执行成功后再原子写键值（记录已完成节点 + 中间输出）。
// 恢复：读取已完成节点集合，从断点续跑。
import type { Checkpoint, Env } from '../types';
import type { WorkflowRow } from '../db/schema';
import { withRetry } from './retry';

const KEY = (execId: string) => `ck:${execId}`;

// 可恢复的写：先写 checkpoint（唯一键持久化）再执行副作用，符合 D1 幂等目标
export function readCheckpoint(env: Env, executionId: string): Promise<Checkpoint | null> {
  return withRetry(async () => {
    const raw = await env.DB.prepare('SELECT checkpoint FROM executions WHERE id=?').bind(executionId).first<{ checkpoint: string | null }>();
    if (!raw?.checkpoint) return null;
    return JSON.parse(raw.checkpoint) as Checkpoint;
  });
}

export function writeCheckpoint(env: Env, executionId: string, cp: Checkpoint): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare('UPDATE executions SET checkpoint=? WHERE id=?')
      .bind(JSON.stringify(cp), executionId).run();
  });
}

// 初始化新执行：workflow 为空时建立
export function freshCheckpoint(workflowId: string, executionId: string): Checkpoint {
  return { workflowId, executionId, completedNodes: [], currentNode: null, data: {}, updatedAt: new Date().toISOString() };
}

// 标记完成
export function markCompleted(env: Env, executionId: string, workflow: WorkflowRow, output?: unknown): Promise<void> {
  return withRetry(async () => {
    const payload = output === undefined ? { workflowName: workflow.name } : output;
    await env.DB.prepare(
      "UPDATE executions SET status='completed', output_data=?, finished_at=datetime('now') WHERE id=?",
    ).bind(JSON.stringify(payload), executionId).run();
  });
}

export function markFailed(env: Env, executionId: string, error: string): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      "UPDATE executions SET status='failed', error_message=?, finished_at=datetime('now') WHERE id=?",
    ).bind(error, executionId).run();
  });
}

// 重试耗尽 → paused（保留检查点供恢复），并释放锁由调用方执行
export function markPaused(env: Env, executionId: string, error: string): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      "UPDATE executions SET status='paused', error_message=? WHERE id=?",
    ).bind(error, executionId).run();
  });
}

// 独立节点执行日志（node_executions），供前端运行历史展示
export interface NodeLog {
  executionId: string;
  nodeName: string;
  nodeType: string;
  status: 'completed' | 'failed' | 'skipped' | 'running';
  retryAttempt?: number;
  inputData?: unknown;
  outputData?: unknown;
  errorMessage?: string;
}

export function logNodeExecution(env: Env, l: NodeLog): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare(
      `INSERT INTO node_executions (execution_id, node_name, node_type, status, retry_attempt, input_data, output_data, error_message, started_at, finished_at)
       VALUES (?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    ).bind(
      l.executionId, l.nodeName, l.nodeType, l.status, l.retryAttempt ?? 0,
      l.inputData !== undefined ? JSON.stringify(l.inputData) : null,
      l.outputData !== undefined ? JSON.stringify(l.outputData) : null,
      l.errorMessage ?? null,
    ).run();
  });
}