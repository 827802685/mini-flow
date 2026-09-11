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
type Item = { json: any };

export class FlowEngine extends WorkflowEntrypoint<Env, FlowPayload> {
  async run(event: WorkflowEvent<FlowPayload>, step: WorkflowStep) {
    // 归一化 event.payload：兼容三种触发形态
    //  A) 内部绑定 FLOW_ENGINE.create({ params }) —— payload 即 params 对象（平铺）
    //  B) REST API create 带 params(JSON 字符串) —— payload={params:'...'}（需解码）
    //  C) REST API 带 input —— payload={input:{...}}
    // 解码并合并，保证节点数组 / 执行 ID 等都能被读取。
    const env = this.env;
    const raw = (event as unknown as { payload?: any }).payload ?? {};
    let decoded: any = null;
    if (typeof raw.params === 'string') {
      try { decoded = JSON.parse(raw.params); } catch { /* keep null */ }
    } else if (raw.params && typeof raw.params === 'object') {
      decoded = raw.params;
    }
    if (!decoded && raw.input && typeof raw.input === 'object') {
      decoded = raw.input;
    }
    const base = decoded ?? raw;
    const p: FlowPayload = {
      workflowId: base.workflowId ?? raw.workflowId ?? 'unknown',
      workflowName: base.workflowName ?? raw.workflowName ?? 'unknown',
      nodes: base.nodes ?? raw.nodes ?? [],
      connections: base.connections ?? raw.connections ?? {},
      executionId: base.executionId ?? raw.executionId ?? 'exec-' + crypto.randomUUID(),
      mode: base.mode ?? raw.mode ?? 'manual',
      input: base.input ?? raw.input ?? {},
      completedNodes: base.completedNodes ?? raw.completedNodes ?? [],
    };
    const emit: (e: PushEvent) => void = (e) => { void sendPush(env, e); };

    emit({ type: 'executionStarted', executionId: p.executionId });

    // 编译 DAG（拓扑序 + 条件分支边）
    const graph = compileWorkflow({ name: p.workflowName, nodes: p.nodes, connections: p.connections });
    // 节点名字 → 该节点产生的结果（原始输出，写检查点用）
    const nodeResults = new Map<string, NodeOutput>();
    // 每个节点已流转到下游的输出分支 → 实际 items（仅含 length>0 的分支；分支路由据此定向）
    const producedBranches = new Map<string, Map<number, Item[]>>();
    // 完成集合（来自 payload 断点恢复 + 本次运行累积）
    const completed = new Set<string>(p.completedNodes ?? []);
    let lastExecuted: string | undefined;

    try {
      // P1-1: 仅执行从入口可达的节点（断开/孤立子图不跑）
      const reachable = computeReachable(graph);

      for (const s of graph.steps) {
        const node = s.node;
        if (!reachable.has(node.name)) continue; // 不可达(孤立子图) → 不执行
        if (completed.has(node.name)) continue;  // 断点跳过

        // 分支路由：收集所有已流转到的入边数据（仅含活跃输出分支）
        const incoming = collectIncoming(graph, node, producedBranches);
        const isEntry = graph.entry?.name === node.name;
        // P1-2: 非入口且无任何活跃入边数据 → 该分支未命中，节点不执行
        if (!isEntry && incoming.length === 0) continue;

        const inputData: NodeOutput = incoming.length > 0
          ? { main: incoming }
          : { main: [{ json: (p.input ?? {}) as any }] };

        // 底线1: 执行前记录 running + currentNode
        emit({ type: 'nodeExecuteBefore', executionId: p.executionId, nodeName: node.name });
        await checkpoint.writeCheckpoint(env, p.executionId, {
          workflowId: p.workflowId, executionId: p.executionId,
          completedNodes: [...completed], currentNode: node.name,
          data: Object.fromEntries(nodeResults) as any, updatedAt: new Date().toISOString(),
        }).catch(() => {});

        const executor = resolveExecutor(node.type);
        if (!executor) {
          // 理论上 resolveExecutor 恒返回执行器（未知节点回落 passthrough），这里仅兜底防御。
          await enqueueDeadLetter(env, {
            executionId: p.executionId, workflowId: p.workflowId,
            nodeName: node.name, nodeType: node.type, nodeParameters: node.parameters,
            lastInputData: p.input, lastError: `未实现节点类型: ${node.type}`,
          });
          await checkpoint.markPaused(env, p.executionId, `未实现节点类型: ${node.type}`);
          emit({ type: 'executionFailed', executionId: p.executionId, error: `未实现节点: ${node.type}` });
          return { executionId: p.executionId, data: {}, lastNodeExecuted: node.name };
        }

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

        // 成功记录：登记输出 + 各活跃输出分支
        completed.add(node.name);
        nodeResults.set(node.name, output);
        producedBranches.set(node.name, branchOutputs(node.type, output));
        lastExecuted = node.name;
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
      const result: RunExecutionResult = { executionId: p.executionId, data: allOutput, lastNodeExecuted: lastExecuted };
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

// 从入口可达节点集（忽略分支活跃性，仅按图连通性）
function computeReachable(graph: { edges: Map<string, any[]>; entry: { name: string } | null }): Set<string> {
  const reach = new Set<string>();
  const entry = graph.entry?.name;
  if (!entry) return reach;
  const queue = [entry];
  reach.add(entry);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of graph.edges.get(cur) ?? []) {
      if (!reach.has(e.to)) { reach.add(e.to); queue.push(e.to); }
    }
  }
  return reach;
}

// 收集流向 node 的所有活跃入边数据（仅当上游对了应分支确实产出了 items）
function collectIncoming(graph: { edges: Map<string, any[]> }, node: { name: string }, produced: Map<string, Map<number, Item[]>>): Item[] {
  const items: Item[] = [];
  for (const [from, list] of graph.edges) {
    for (const e of list) {
      if (e.to !== node.name) continue;
      const arr = produced.get(from)?.get(e.branch);
      if (arr && arr.length) items.push(...arr);
    }
  }
  return items;
}

// 把一个节点的执行结果归一化为「输出分支 → items」。
//  IF  ：branch=true→main[0](index0)，branch=false→main[1](index1)
//  Switch/多分支：按 main_N 键取活跃分支
//  单输出节点：非空 main → index0
function branchOutputs(nodeType: string, out: unknown): Map<number, Item[]> {
  const map = new Map<number, Item[]>();
  if (!out || typeof out !== 'object') return map;
  const o = out as Record<string, any>;
  // IF：用 branch 布尔决定 0/1
  if ('branch' in o) {
    const idx = o.branch === true ? 0 : (o.branch === false ? 1 : -1);
    if (idx >= 0 && Array.isArray(o.main) && o.main.length) map.set(idx, o.main);
    return map;
  }
  // Switch / 多分支：main_N 键为命中分支
  let hasExplicit = false;
  for (const k of Object.keys(o)) {
    const m = /^main_(\d+)$/.exec(k);
    if (m && Array.isArray(o[k]) && o[k].length) { map.set(Number(m[1]), o[k]); hasExplicit = true; }
  }
  if (!hasExplicit && Array.isArray(o.main) && o.main.length) map.set(0, o.main);
  return map;
}