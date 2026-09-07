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
  const nodes = workflow.nodes.filter((n) => !n.disabled);
  const edges = new Map<string, Array<{ to: string; branch: number }>>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.name, 0);

  for (const [from, conn] of Object.entries(workflow.connections || {})) {
    const mains = conn.main || [];
    for (let branchIdx = 0; branchIdx < mains.length; branchIdx++) {
      for (const target of mains[branchIdx] || []) {
        if (!inDegree.has(from)) inDegree.set(from, 0);
        const list = edges.get(from) ?? [];
        list.push({ to: target.node, branch: branchIdx });
        edges.set(from, list);
        inDegree.set(target.node, (inDegree.get(target.node) ?? 0) + 1);
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