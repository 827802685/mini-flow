// util-nodes: 列表 / 数据工具 / 存储节点执行器（真实可执行）
// Limit / RenameKeys / Zip / ItemLists(List/Join/Aggregate) / GetMultiple / Store(KV) / Convert。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

// ---- Limit：限制输出条数 ----
export const limitNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const max = Number(p.maxItems ?? p.limit ?? 10) || 10;
    return { main: (ctx.inputData?.main ?? []).slice(0, max) };
  },
};

// ---- Rename Keys：批量重命名字段 ----
export const renameKeysNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const renames = p.renaming ?? p.renameKeys ?? [];
    const items = ctx.inputData?.main ?? [];
    return { main: items.map((it) => {
      const j: Record<string, any> = { ...(it.json ?? {}) };
      for (const r of (renames as any[])) {
        const from = r.fromKey ?? r.oldKey; const to = r.toKey ?? r.newKey;
        if (from && to && from in j) { j[to] = j[from]; delete j[from]; }
      }
      return { json: j };
    }) };
  },
};

// ---- Zip：把多条输入压成单条对象（field: 数组值 / list: 下标&值） ----
export const zipNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const mode = String(p.mode ?? 'field');
    const field = raw(p.field);
    if (mode === 'list') {
      return { main: items.map((it, i) => ({ json: { ...(it.json ?? {}), index: i, value: it.json } })) };
    }
    const out: Record<string, unknown> = {};
    if (field) out[field] = items.map((i) => i.json);
    else out.items = items.map((i) => i.json);
    return { main: [{ json: out }] };
  },
};

// ---- Item Lists：把对象的数组字段拆成多行（Data Transform>Item Lists 的 flatten 能力） ----
export const itemListsNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const field = String(p.fieldToSplitName ?? p.field ?? 'items');
    const items = ctx.inputData?.main ?? [];
    const out: Item[] = [];
    for (const it of items) {
      const j = it.json ?? {};
      const arr = j[field];
      if (Array.isArray(arr)) {
        for (const el of arr) out.push({ json: { ...j, [field]: el } });
      } else {
        out.push(it);
      }
    }
    return { main: out };
  },
};

// ---- Store (Key/Value)：读写 worker KV(CREDENTIALS) ----
export const storeNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const op = String(p.operation ?? 'get');
    const key = raw(p.key ?? p.name ?? 'value');
    const items = ctx.inputData?.main ?? [];
    const value = p.value ?? items[0]?.json;
    try {
      if (op === 'delete') { await ctx.env.CREDENTIALS.delete(key); return { main: [{ json: { key, deleted: true } }] }; }
      if (op === 'set' || op === 'put') { await ctx.env.CREDENTIALS.put(key, typeof value === 'string' ? value : JSON.stringify(value ?? '')); return { main: [{ json: { key, set: true } }] }; }
      // get 默认
      const got = await ctx.env.CREDENTIALS.get(key);
      let parsed: unknown = got;
      if (got != null) { try { parsed = JSON.parse(got); } catch { /* keep raw string */ } }
      return { main: [{ json: { key, value: parsed ?? null } }] };
    } catch (e) {
      return { main: [{ json: { key, error: e instanceof Error ? e.message : String(e) } }] };
    }
  },
};

// ---- Convert To JSON / From JSON（乘数据转换） ----
export const convertToJsonNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const field = raw(p.field ?? p.dataPropertyName ?? 'json');
    const keep = p.options?.keepSourceField ?? false;
    return { main: items.flatMap((it) => {
      const j = it.json ?? {};
      const src = field.split('.').reduce<any>((a, k) => (a == null ? a : a[k]), j);
      let parsed: unknown = src;
      if (typeof src === 'string') { try { parsed = JSON.parse(src); } catch { parsed = src; } }
      const base = { ...j };
      if (!keep) deleteProp(base, field);
      if (Array.isArray(parsed)) return parsed.map((x) => ({ json: { ...base, json: x } }));
      if (parsed && typeof parsed === 'object') return [{ json: { ...base, ...(parsed as Record<string, any>) } }];
      return [{ json: { ...base, json: parsed } }];
    }) };
  },
};

// ---- Join / Aggregate List：把单条内的数组字段合并（对接下游单值处理） ----
export const joinListNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const field = raw(p.field ?? p.dataPropertyName ?? 'json');
    const sep = raw(p.separator ?? ',');
    const all: string[] = [];
    for (const it of items) {
      const j = it.json ?? {};
      const v: unknown = field.split('.').reduce<any>((a, k) => (a == null ? a : a[k]), j);
      if (Array.isArray(v)) {
        for (const el of v) all.push(str(el));
      } else if (v !== undefined && v !== null) {
        all.push(str(v));
      } else {
        all.push(str(it.json));
      }
    }
    return { main: [{ json: { result: all.join(sep), count: all.length } }] };
  },
};
function str(v: unknown): string {
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// ---- Assign：节点内声明变量（存储在输出字段,用于模板/后续引用） ----
export const assignNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const assigns = p.assignments ?? p.parameters ?? [];
    const toItem = (arr: unknown[]): any[] => arr.length ? arr : [{}];
    return { main: toItem(items).map((it) => {
      const j: Record<string, any> = { ...(it.json ?? {}) };
      for (const a of (assigns as any[])) {
        if (a.name) j[a.name] = a.value;
      }
      return { json: j };
    }) };
  },
};

function raw(v: unknown): string { return v === undefined || v === null ? '' : String(v); }
function deleteProp(obj: Record<string, any>, path: string): void {
  const parts = path.split('.'); if (parts.length === 1) { delete obj[path]; return; }
  const last = parts.pop()!; const parent = parts.reduce<any>((a, k) => (a == null ? a : a[k]), obj);
  if (parent && typeof parent === 'object') delete parent[last];
}