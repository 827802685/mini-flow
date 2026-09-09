// text-nodes: 文本处理节点执行器（真实可执行）
// 文本替换 / 正则提取 / 大小写 / 拆分 / 模板插值 / 截断。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

function interp(tpl: string, item: Record<string, any>): string {
  return tpl.replace(/\{\{\s*\$?json\.([\w.]+)\s*\}\}|{{\s*([\w.]+)\s*}}/g, (_m, a, b) => {
    const p = ((a ?? b) as string).split('.');
    const v: unknown = p.reduce((acc: any, k: string) => (acc == null ? acc : acc[k]), item);
    return v === undefined || v === null ? '' : String(v);
  });
}
function raw(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

// 通用逐项处理辅助
function mapItems(ctx: NodeExecutionContext, fn: (json: Record<string, any>) => Record<string, any>): NodeOutput {
  const items = ctx.inputData?.main ?? [];
  if (items.length === 0) return { main: [] };
  return { main: items.map((it) => ({ json: fn(it.json ?? {}) })) };
}

// ---- Text Replace：查找/替换 ----
export const textReplaceNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const field = raw(p.field); const val = raw(getVal(j, field));
      const find = raw(p.search ?? p.oldValue); const repl = raw(p.replace ?? p.newValue);
      return { ...j, [field]: val.split(find).join(repl) };
    });
  },
};

// ---- Regex Extract：正则提取 ----
export const regexExtractNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const field = raw(p.field); const val = raw(getVal(j, field));
      const regex = String(p.regex ?? '');
      try {
        const m = new RegExp(regex, p.caseInsensitive ? 'i' : '').exec(val);
        const out: Record<string, any> = { ...j, match: m ? m[0] : null };
        if (m && m.length > 1) out.groups = m.slice(1);
        return out;
      } catch {
        return { ...j, match: null };
      }
    });
  },
};

// ---- Text Case：大小写转换 ----
export const textCaseNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const field = raw(p.field ?? 'text'); const val = raw(getVal(j, field));
      const mode = String(p.action ?? p.mode ?? 'uppercase');
      let out = val;
      if (mode.includes('upper')) out = val.toUpperCase();
      else if (mode.includes('lower')) out = val.toLowerCase();
      else if (mode.includes('title')) out = val.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
      else if (mode.includes('sentence')) out = val.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
      return { ...j, [field]: out };
    });
  },
};

// ---- Split Out：按分隔符拆成数组 ----
export const textSplitNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const field = raw(p.field); const val = raw(getVal(j, field));
      const sep = String(p.separator ?? ',');
      const arr = val.split(sep).filter((s) => s.length || p.keepEmpty);
      return { ...j, [field]: arr };
    });
  },
};

// ---- Text Template：模板插值 ----
export const textTemplateNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const template = raw(p.template ?? p.text);
      return { ...j, output: interp(template, j) };
    });
  },
};

// ---- Text Truncate：截断/子串 ----
export const textTruncateNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const field = raw(p.field); const val = raw(getVal(j, field));
      const len = Number(p.length ?? p.maxLength ?? 100) || 100;
      return { ...j, [field]: val.length > len ? val.slice(0, len) : val };
    });
  },
};

// ---- Text Count：统计字符/单词/行数 ----
export const textCountNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    return mapItems(ctx, (j) => {
      const field = raw(p.field); const val = raw(getVal(j, field));
      return { ...j, count: { characters: val.length, words: val.trim() ? val.trim().split(/\s+/).length : 0, lines: val ? val.split('\n').length : 0 } };
    });
  },
};

function getVal(j: Record<string, any>, field: string): unknown {
  return field.split('.').reduce<any>((a, k) => (a == null ? a : a[k]), j);
}