// dag: 把 n8n workflow JSON 编译为可执行的步骤序列（含条件分支）
// n8n connections 形态: { [from]: { main: [ [ {node: toName} ], [ ] ] } }
// main[0] = true/主线, main[1] = IF 的 false 分支
import type { N8nWorkflow, N8nNode } from '../types';

export interface Step {
  node: N8nNode;
  order: number;
}

export interface DagGraph {
  steps: Step[];
  // 从节点名 → 其下游 [(目标节点名, 分支index?)]
  edges: Map<string, Array<{ to: string; branch: number }>>;
  // 入口节点（无上游）
  entry: N8nNode | null;
  // 出边为条件分支的节点（其下游需要按分支 index 定向）
}

export function compileWorkflow(workflow: N8nWorkflow): DagGraph {
  // 归一化：缺失 name 的节点用 type(位置索引) 兜底，避免整条链 key 变成 "undefined"
  const raw = workflow.nodes.filter((n) => !n.disabled).map((n, i) => ({ ...n, name: n.name || n.name === '' ? n.name : `node_${i}_${n.type.split('.').pop() ?? 'n'}` }));
  const nameById = new Map<string, string>();
  for (const n of raw) if (n.id) nameById.set(n.id, n.name);
  // 让 connections 里的目标（可能是 id 或 name）与节点 name 对齐
  const connKey = (key: string) => (nameById.has(key) ? nameById.get(key)! : key);
  const nodes = raw;
  const edges = new Map<string, Array<{ to: string; branch: number }>>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.name, 0);

  for (const [from, conn] of Object.entries(workflow.connections || {})) {
    const mains = conn.main || [];
    for (let branchIdx = 0; branchIdx < mains.length; branchIdx++) {
      for (const target of mains[branchIdx] || []) {
        const f = connKey(from);
        const t = connKey(target.node);
        if (!inDegree.has(f)) inDegree.set(f, 0);
        const list = edges.get(f) ?? [];
        list.push({ to: t, branch: branchIdx });
        edges.set(f, list);
        inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
      }
    }
  }

  // Kahn 拓扑排序（稳定顺序：按原数组顺序出队）
  const queue = nodes.filter((n) => (inDegree.get(n.name) ?? 0) === 0);
  const steps: Step[] = [];
  const visited = new Set<string>();
  let order = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur.name)) continue;
    visited.add(cur.name);
    steps.push({ node: cur, order: order++ });
    for (const e of edges.get(cur.name) ?? []) {
      const deg = (inDegree.get(e.to) ?? 0) - 1;
      inDegree.set(e.to, deg);
      if (deg === 0) {
        const t = nodes.find((n) => n.name === e.to);
        if (t) queue.push(t);
      }
    }
  }

  // 入口节点：入度 0 的第一个节点
  let entryNode: N8nNode | null = null;
  for (const n of nodes) {
    if ((inDegree.get(n.name) ?? 0) === 0) {
      entryNode = n; break;
    }
  }

  return { steps, edges, entry: entryNode };
}