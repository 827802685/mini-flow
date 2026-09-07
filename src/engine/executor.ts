// executor: 业务调度主入口
// 职责：加载 D1 workflow → 建 execution → 抢锁 → 编译 DAG → 交给 Workflows 执行
//（断点续跑/retry/Push 由 runtime/flow-engine.ts 与 push.ts 承担；此处保证链路完整）

import type { Env, N8nWorkflow, PushEvent } from '../types';
import { parseWorkflowRow, type WorkflowRow } from '../db/schema';
import { compileWorkflow } from './dag';
import { freshCheckpoint, writeCheckpoint, readCheckpoint } from './checkpoint';
import { tryAcquireExecutionLock, releaseLock } from './lock';
import { withRetry } from './retry';

export interface RunOutcome {
  ok: boolean;
  executionId: string;
  error?: string;
}

export type ExecutionMode = 'manual' | 'webhook' | 'cron' | 'trigger';

// 从 D1 取工作流（带重试）
export function loadWorkflow(env: Env, workflowId: string): Promise<WorkflowRow> {
  return withRetry(async () => {
    const row = await env.DB.prepare('SELECT * FROM workflows WHERE id=?').bind(workflowId).first<WorkflowRow>();
    if (!row) throw new Error(`Workflow not found: ${workflowId}`);
    return row;
  });
}

// 手动/Webhook 触发：建 execution + 抢锁 + 编译 + 提交。返回 executionId。
export async function startExecution(
  env: Env,
  workflow: N8nWorkflow,
  input: unknown,
  mode: ExecutionMode,
  emit: (e: PushEvent) => void,
): Promise<RunOutcome> {
  const workflowId = workflow.id!;
  const executionId = crypto.randomUUID();

  // 1. 建 execution（先写后执行：恢复所需记录已存在）
  await withRetry(async () => {
    await env.DB.prepare(
      "INSERT INTO executions (id, workflow_id, status, trigger_type, mode, input_data, started_at) VALUES (?,?,'pending',?,?,?,datetime('now'))",
    ).bind(executionId, workflowId, mode, mode, JSON.stringify(input)).run();
  });

  // 2. 抢锁（防重叠；manual 也可用同一机制）
  const lock = await tryAcquireExecutionLock(env, executionId).catch(() => ({ ok: true }));
  if (!lock.ok) {
    return { ok: false, executionId, error: 'another execution is running' };
  }

  // 3. 编译 DAG
  const graph = compileWorkflow(workflow);

  // 4. 初始化 checkpoint 并提交给 Workflows 引擎
  const cp = freshCheckpoint(workflowId, executionId);
  await writeCheckpoint(env, executionId, cp).catch(() => {});

  // 通知前端执行已开始（通过 Durable Object push）
  emit({ type: 'executionStarted', executionId });

  // 5. 交给 Workflows（runtime/flow-engine.ts）
  void env.FLOW_ENGINE.create({
    id: executionId, // 用唯一 id 保证幂等，同一执行只创建一次
    params: {
      workflowId,
      workflowName: workflow.name,
      nodes: workflow.nodes, // 节点定义数组（flow-engine 按序执行）
      executionId,
      mode,
      input: input === undefined ? {} : input,
      completedNodes: cp.completedNodes, // 断点续跑：恢复已完成的（真实 engine 会再核对 checkpoint）
    },
  });

  // 6. 更新 running 状态（Workflows 异步，这里不 await 完成）
  await withRetry(async () => {
    await env.DB.prepare("UPDATE executions SET status='running' WHERE id=?").bind(executionId).run();
  }).catch(() => {});

  // push 的 finished/failed 事件由 flow-engine.ts 在真实执行中通过 Durable Object 发出。
  return { ok: true, executionId };
}

// 从断点恢复（resume）：读 checkpoint 定位续跑位置
export async function resumeExecution(env: Env, executionId: string): Promise<{ cp: Awaited<ReturnType<typeof readCheckpoint>>; exists: boolean }> {
  const cp = await readCheckpoint(env, executionId);
  return { cp, exists: cp !== null };
}

// 完成后释放锁（由 flow-engine 在 finally 调用）
export { releaseLock };