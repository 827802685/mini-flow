// extra-nodes: 扩展预设节点（全部真实可执行）
// PickFields / DropFields / TextTrim / TextSlice / Flatten / SplitToItems / AddMeta(ID+时间戳)。
// 每个节点带可编辑参数(properties)与纯逻辑执行器，适合在消息管道里做字段裁剪与文本清洗。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

function raw(v: unknown): string { return v === undefined || v === null ? '' : String(v); }

// ---- Pick Fields：仅保留指定字段 ----
export const keepFieldsNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const fields: string[] = (p.fields ?? p.fieldList ?? []);
    const keep = fields.map((f) => raw(f)).filter(Boolean);
    if (!keep.length) return { main: items };
    return { main: items.map((it) => {
      const src = it.json ?? {};
      const j: Record<string, any> = {};
      for (const k of keep) if (k in src) j[k] = src[k];
      return { json: j };
    }) };
  },
};

// ---- Drop Fields：删除指定字段，其余保留 ----
export const dropFieldsNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const fields: string[] = (p.fields ?? p.fieldList ?? []);
    const drop = fields.map((f) => raw(f)).filter(Boolean);
    if (!drop.length) return { main: items };
    return { main: items.map((it) => {
      const j: Record<string, any> = { ...(it.json ?? {}) };
      for (const k of drop) delete j[k];
      return { json: j };
    }) };
  },
};

// ---- Text Trim：清理文本首尾空白，可选压缩多余换行/空白 ----
export const textTrimNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const field = raw(p.field ?? 'text');
    const collapse = String(p.collapseWhitespace ?? 'false') === 'true';
    return { main: items.map((it) => {
      const j: Record<string, any> = { ...(it.json ?? {}) };
      const v: unknown = j[field];
      if (typeof v === 'string') {
        let s = v.trim();
        if (collapse) s = s.replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n');
        j[field] = s;
      }
      return { json: j };
    }) };
  },
};

// ---- Text Slice：按起止/长度截取子串 ----
export const textSliceNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const field = raw(p.field ?? 'text');
    const start = Number(p.start ?? 0) || 0;
    const end = p.length !== undefined && p.length !== '' ? Number(p.length) : undefined;
    return { main: items.map((it) => {
      const j: Record<string, any> = { ...(it.json ?? {}) };
      const v: unknown = j[field];
      if (typeof v === 'string') j[field] = end === undefined || end <= 0 ? v.slice(start) : v.slice(start, start + end);
      return { json: j };
    }) };
  },
};

// ---- Flatten：把嵌套 JSON 展开为点分字段（拍平 1 层，默认） ----
export const flattenNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const field = raw(p.field ?? '');
    const prefix = raw(p.prefix ?? '');
    const flatten = (obj: Record<string, any>, pre: string, depth: number): Record<string, any> => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = pre ? `${pre}.${k}` : k;
        if (depth > 0 && v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, any>, key, depth - 1));
        else out[key] = v;
      }
      return out;
    };
    const flattenOne = (json: Record<string, any>): Record<string, any> => {
      if (field) {
        const v = json[field];
        const flat = v && typeof v === 'object' && !Array.isArray(v) ? flatten(v as Record<string, any>, prefix, 1) : {};
        return { ...json, ...flat };
      }
      return flatten(json, prefix, 1);
    };
    return { main: items.map((it) => ({ json: flattenOne(it.json ?? {}) })) };
  },
};

// ---- Split To Items：文本按分隔符拆成多条 Item（区别于 splitOut 的数组内拆分） ----
export const splitToItemsNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const field = raw(p.field ?? 'text');
    const sep = raw(p.separator ?? '\n');
    const out: Item[] = [];
    for (const it of items) {
      const j = it.json ?? {};
      const v = j[field];
      const parts = typeof v === 'string' ? v.split(sep) : [v];
      for (const part of parts) out.push({ json: { ...j, [field]: part } });
    }
    return { main: out };
  },
};

// ---- Add Meta：为每条附加 id(UUID) 与时间戳 ----
export const addMetaNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const idField = raw(p.idField ?? 'id');
    const timeField = raw(p.timeField ?? 'ts');
    const itemsCount = items.length || 1;
    const ts = new Date().toISOString();
    const toItem = (arr: Item[]): Item[] => arr.length ? arr : [{ json: {} }];
    return {
      main: toItem(items).map((it, idx) => {
        const j: Record<string, any> = { ...(it.json ?? {}) };
        if (p.idField !== undefined || p.addId !== false) j[idField] = j[idField] ?? `${ctx.executionId}-${idx}-${(Math.random().toString(36) + '000').slice(2, 8)}`;
        if (p.timeField !== undefined || p.addTs !== false) j[timeField] = p.timeField !== undefined ? ts : (j[timeField] ?? ts);
        return { json: j };
      }),
    };
  },
};