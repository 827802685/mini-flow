// flow-engine: extends WorkflowEntrypoint
// 断点续跑底座。Workflow.create(payload) 后由本类按 step 执行。
// 使用 step.idempotent 获得持久化 + 自动重试 + 平台级中断恢复。
import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { Env, RunExecutionResult, PushEvent } from '../types';
import { resolveExecutor } from '../nodes';
import { withRetry } from '../engine/retry';
import * as checkpoint from '../engine/checkpoint';

export interface FlowPayload {
  workflowId: string;
  workflowName: string;
  executionId: string;
  mode: string;
  input: unknown;
  completedNodes: string[];
}

export class FlowEngine extends WorkflowEntrypoint<Env, FlowPayload> {
  async run(event: WorkflowEvent<FlowPayload>, step: WorkflowStep) {
    const p = event.payload;
    const env = this.env;

    // 节点执行（幂等：step.idempotent 保证同一参数只执行一次副作用）
    const outputOf = new Map<string, unknown>();

    // 通过 step 读取本执行已持久化的中间结果（断点续跑载体）
    // 真实 n8n 数据路径在此与 checkpoint 对齐：completedNodes 已在 payload 传入恢复。
    const emit: (e: PushEvent) => void = (e) => {
      // 推送执行事件到 Durable Object 门面（见 push.ts）。
      // Workflows 内访问 Durable Object 需通过 binding 调用；骨架此处占位。
    };

    // 逐节点按 order 执行（真实实现会用 step.idempotent 包裹每个节点）
    for (const node of (p as any).nodes ?? []) {
      if ((p.completedNodes ?? []).includes(node.name)) continue; // 断点跳过
      const executor = resolveExecutor(node.type);
      if (!executor) {
        emit({ type: 'executionFailed', executionId: p.executionId, error: `未实现节点: ${node.type}` });
        throw new Error(`未实现节点类型: ${node.type}`);
      }

      const out = await step.do(
        `exec:${node.name}`,
        () => this.executeNode(env, executor, node, outputOf, p),
      );
      outputOf.set(node.name, out);
      await checkpoint.writeCheckpoint(env, p.executionId, {
        workflowId: p.workflowId,
        executionId: p.executionId,
        completedNodes: [...(p.completedNodes ?? []), node.name],
        currentNode: null,
        data: Object.fromEntries(outputOf),
        updatedAt: new Date().toISOString(),
      });
    }

    const result: RunExecutionResult = {
      executionId: p.executionId,
      data: {},
      lastNodeExecuted: undefined,
    };
    return result;
  }

  private async executeNode(env: Env, executor: ReturnType<typeof resolveExecutor>, node: any, _outputOf: Map<string, unknown>, p: FlowPayload) {
    const input = p.input ?? {};
    return withRetry(() => executor!.execute({
      workflow: { name: p.workflowName, nodes: [], connections: {} } as any,
      executionId: p.executionId,
      node,
      inputData: { main: [{ json: input }] } as any,
      env,
      log: () => {},
    }), { maxAttempts: 3 });
  }
}