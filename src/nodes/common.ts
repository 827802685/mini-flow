// common-nodes: 常用数据流节点执行器
// Merge / SplitInBatches / Delay / Output 等 n8n 基础数据/流程节点。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

// ---- Merge：合并多个分支输入 ----
// n8n merge 支持 append(1,2 全保留) / combine(逐项合并) / chooseBranch 等 mode。
// 引擎为线性 main 模型，这里把汇入的多个 input 通道聚合到 main。
export const mergeNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const mode = ctx.node.parameters?.mode ?? 'append';
    const out: Item[] = [];
    const branches = Object.keys(ctx.inputData ?? {}).filter((k) => k !== 'main');
    const allStreams: Item[][] = [];

    // 若存在多条非 main 输入（合并节点通常有 main[0]/main[1] 两条上游），逐通道收集
    const mains = ctx.inputData?.main ?? [];
    if (branches.length === 0) {
      return { main: mains };
    }
    for (const key of ['main', ...branches]) {
      const items = ctx.inputData?.[key] ?? [];
      if (items.length) allStreams.push(items);
    }
    if (allStreams.length === 0) return { main: [] };

    if (mode === 'combine') {
      const len = Math.max(...allStreams.map((s) => s.length));
      for (let i = 0; i < len; i++) {
        const merged: Record<string, any> = {};
        for (const stream of allStreams) if (stream[i]) Object.assign(merged, stream[i].json);
        out.push({ json: merged });
      }
    } else {
      // append 默认
      for (const stream of allStreams) out.push(...stream);
    }
    return { main: out };
  },
};

// ---- SplitInBatches：按批次切分输入 ----
// n8n 通过"每次执行处理 N 项并循环"实现分批。引擎线性模型无循环状态，
// 这里把输入切成 batchSize 一批，首批发到 main，余批写入 main_rest 便于下游感知总量。
export const splitInBatchesNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const size = Number(p.batchSize ?? p.batch?.batchSize ?? 10) || 10;
    const items = ctx.inputData?.main ?? [];
    if (items.length === 0) return { main: [] };
    const first = items.slice(0, size);
    const rest = items.slice(size);
    return { main: first, main_rest: rest };
  },
};

// ---- Delay：可选的延迟/节流（受限，最长 30s，超长则跳过并透传） ----
export const delayNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const res = p.resume ?? p.delay ?? {};
    // n8n delay 形态：{ amount, unit } 或 { unitInterval, interval }
    const amount = Number(res.amount ?? p.amount ?? 0) || 0;
    const unitObj = res.unit ?? p.unit ?? 'seconds';
    const unit = typeof unitObj === 'object' ? (unitObj as any)?.value ?? 'seconds' : unitObj;
    const mult: Record<string, number> = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000 };
    const ms = amount * (mult[String(unit)] ?? 1000);
    if (ms > 0 && ms <= 30_000) {
      await new Promise((r) => setTimeout(r, ms));
    }
    return { main: [...(ctx.inputData?.main ?? [])] };
  },
};

// ---- Output：结果透出（soak/最后一项） ----
export const outputNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    if ((p.options?.outputs ?? p.outputs) === 'last') {
      return items.length ? { main: [items[items.length - 1]] } : { main: [] };
    }
    return { main: items };
  },
};