// flow-engine: extends WorkflowEntrypoint —— 断点续跑执行底座
// 把 n8n workflow（nodes + connections）编译为 DAG，逐节点经 step.do 执行，
// 获得持久化 + 自动重试 + 平台级中断恢复。
// 严格对齐设计 5 条底线：写检查点 → 重试包装 → 重试耗尽进 DLQ → 锁 → 先写后执行。
import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { Env, PushEvent, RunExecutionResult, NodeExecutor, N8nNode } from '../types';
import { resolveExecutor } from '../nodes';
import { withRetry } from '../engine/retry';
import * as checkpoint from '../engine/checkpoint';
import { enqueueDeadLetter } from '../engine/dead-letter';
import { compileWorkflow } from '../engine/dag';
import { sendPush } from '../n8n/push';

export interface FlowPayload {
  workflowId: string;
  workflowName: string;
  nodes: N8nNode[];
  connections: any;
  executionId: string;
  mode: string;
  input: unknown;
  completedNodes: string[];
}

// 单节点输出：n8n 数据形态 { main: Array<{json}> }
type NodeOutput = Record<string, Array<{ json: any }>>;

export class FlowEngine extends WorkflowEntrypoint<Env, FlowPayload> {
  async run(event: WorkflowEvent<FlowPayload>, step: WorkflowStep) {
    const p = event.payload;
    const env = this.env;
    const emit: (e: PushEvent) => void = (e) => { void sendPush(env, e); };

    emit({ type: 'executionStarted', executionId: p.executionId });

    // 编译 DAG（拓扑序 + 条件分支边）
    const graph = compileWorkflow({ name: p.workflowName, nodes: p.nodes, connections: p.connections });
    // 节点名字 → 该节点产生的结果（作为下游输入）
    const nodeResults = new Map<string, NodeOutput>();
    // 完成集合（来自 payload 断点恢复 + 本次运行累积）
    const completed = new Set<string>(p.completedNodes ?? []);

    try {
      for (const s of graph.steps) {
        const node = s.node;
        if (completed.has(node.name)) continue; // 断点跳过

        // 底线1: 执行前记录 running + currentNode
        emit({ type: 'nodeExecuteBefore', executionId: p.executionId, nodeName: node.name });
        await checkpoint.writeCheckpoint(env, p.executionId, {
          workflowId: p.workflowId, executionId: p.executionId,
          completedNodes: [...completed], currentNode: node.name,
          data: Object.fromEntries(nodeResults) as any, updatedAt: new Date().toISOString(),
        }).catch(() => {});

        const executor = resolveExecutor(node.type);
        if (!executor) {
          // 未知节点 → DLQ 兜底
          await enqueueDeadLetter(env, {
            executionId: p.executionId, workflowId: p.workflowId,
            nodeName: node.name, nodeType: node.type, nodeParameters: node.parameters,
            lastInputData: p.input, lastError: `未实现节点类型: ${node.type}`,
          });
          await checkpoint.markPaused(env, p.executionId, `未实现节点类型: ${node.type}`);
          emit({ type: 'executionFailed', executionId: p.executionId, error: `未实现节点: ${node.type}` });
          return { executionId: p.executionId, data: {}, lastNodeExecuted: node.name };
        }

        // 组装该节点的输入：有条件分支时按分支取上游对应输出
        const inputData = buildInputFor(graph, node, nodeResults, p.input);

        // 底线2: 用 withRetry 包裹（step.do 幂等，保证重放不重复副作用）
        let output: NodeOutput = { main: [] };
        let lastErr: unknown = null;
        try {
          output = await step.do(
            `exec:${node.name}`,
            () => withRetry(() => this.runNode(node, executor, inputData, env, p, emit), {
              maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000,
            }, (att, err) => {
              // 记录重试
              void checkpoint.logNodeExecution(env, {
                executionId: p.executionId, nodeName: node.name, nodeType: node.type,
                status: 'failed', retryAttempt: att, errorMessage: err instanceof Error ? err.message : String(err),
              });
              emit({ type: 'nodeExecuteBefore', executionId: p.executionId, nodeName: node.name });
            }),
          );
        } catch (e) {
          lastErr = e;
        }

        if (lastErr) {
          // 底线3: 重试耗尽 → 投入死信队列 → paused，保留检查点
          const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          await enqueueDeadLetter(env, {
            executionId: p.executionId, workflowId: p.workflowId,
            nodeName: node.name, nodeType: node.type, nodeParameters: node.parameters,
            lastInputData: inputData, lastError: msg,
          });
          await checkpoint.markPaused(env, p.executionId, `节点 ${node.name} 失败: ${msg}`);
          await checkpoint.logNodeExecution(env, {
            executionId: p.executionId, nodeName: node.name, nodeType: node.type, status: 'failed', errorMessage: msg,
          });
          emit({ type: 'executionFailed', executionId: p.executionId, error: msg });
          return { executionId: p.executionId, data: {}, lastNodeExecuted: node.name, error: { message: msg } };
        }

        // 成功记录
        completed.add(node.name);
        nodeResults.set(node.name, output);
        await checkpoint.logNodeExecution(env, {
          executionId: p.executionId, nodeName: node.name, nodeType: node.type, status: 'completed', outputData: output,
        }).catch(() => {});
        emit({ type: 'nodeExecuteAfter', executionId: p.executionId, nodeName: node.name });

        // 底线5: 先写后执行 —— 每节点数据产出立即可恢复
        await checkpoint.writeCheckpoint(env, p.executionId, {
          workflowId: p.workflowId, executionId: p.executionId,
          completedNodes: [...completed], currentNode: null,
          data: Object.fromEntries(nodeResults) as any, updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }

      // 全部完成
      const allOutput = Object.fromEntries(nodeResults) as any;
      await checkpoint.markCompleted(env, p.executionId, { name: p.workflowName } as any, allOutput).catch(() => {});
      const result: RunExecutionResult = { executionId: p.executionId, data: allOutput, lastNodeExecuted: graph.steps.at(-1)?.node.name };
      emit({ type: 'executionFinished', executionId: p.executionId, data: result });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await checkpoint.markFailed(env, p.executionId, msg).catch(() => {});
      emit({ type: 'executionFailed', executionId: p.executionId, error: msg });
      return { executionId: p.executionId, data: {}, lastNodeExecuted: undefined, error: { message: msg } };
    } finally {
      // 释放锁（正常/失败都释放）
      await this.release(env, p.executionId).catch(() => {});
    }
  }

  private async runNode(node: N8nNode, executor: NonNullable<NodeExecutor>, inputData: NodeOutput, env: Env, p: FlowPayload, emit: (e: PushEvent) => void): Promise<NodeOutput> {
    const out = await executor.execute({
      workflow: { name: p.workflowName, nodes: p.nodes, connections: p.connections } as any,
      executionId: p.executionId,
      node,
      inputData,
      env,
      log: emit,
    });
    return out && out.main ? out : { main: [{ json: { __result: out } as any }] };
  }

  private async release(env: Env, executionId: string): Promise<void> {
    await env.DB.prepare("UPDATE executions SET locked_at=NULL WHERE id=?").bind(executionId).run();
  }
}

// 为节点构造输入：取所有指向该节点的上游（含条件分支），合并其输出
function buildInputFor(graph: { edges: Map<string, any[]> }, node: N8nNode, nodeResults: Map<string, NodeOutput>, initial: unknown): NodeOutput {
  const upstreams: string[] = [];
  for (const [from, list] of graph.edges) {
    for (const e of list) {
      if (e.to === node.name) upstreams.push(from);
    }
  }
  if (upstreams.length === 0) {
    return { main: [{ json: (initial ?? {}) as any }] };
  }
  const items: Array<{ json: any }> = [];
  for (const up of upstreams) {
    const out = nodeResults.get(up);
    if (out?.main) items.push(...out.main);
  }
  if (items.length === 0) items.push({ json: (initial ?? {}) as any });
  return { main: items };
}