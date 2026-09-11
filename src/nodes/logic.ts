// logic: 无需凭据的通用逻辑/数据节点执行器
// 补齐模板中常出现的：noOp / respondToWebhook / switch / removeDuplicates / errorTrigger / textSplitter
import type { NodeExecutionContext } from '../types';
import { safeEvaluate } from '../engine/evaluator';
import { compare } from './if-condition';

type Item = { json: any };
type NodeOutput = Record<string, Item[]>;

// 求值一个值：n8n 表达式 {{= expr }} / {{ json.x }} 视为表达式求值；普通字符串视为字面量原样返回
function keepType(value: unknown, item: Record<string, any>): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  // n8n 表达式包裹：={{ expr }}
  const em = t.match(/^=\{\{\s*([\s\S]*?)\s*\}\}\s*$/);
  if (em) return evalExpr(em[1], item);
  // 整串即字段引用：{{ json.xxx }} / {{ $json.xxx }}
  const m = value.match(/^\s*\{\{\s*\$?json\.([\w.]+)\s*\}\}\s*$/);
  if (m) return pathGet(item, m[1]);
  // 含 {{ }} 的其它表达式 → 求值；失败回退字面量
  if (value.includes('{{') || value.startsWith('=')) {
    const ev = safeEvaluate(t, { json: item });
    if (ev.ok) return ev.value;
  }
  // 普通字符串字面量
  return value;
}

function pathGet(item: Record<string, any>, path: string): unknown {
  return path.split('.').reduce<any>((a, k) => (a == null ? a : a[k]), item);
}

// 求值 n8n 表达式内容（已剥掉 {{ }}）：优先 $json.x 路径直取，其次白名单求值器
function evalExpr(expr: string, item: Record<string, any>): unknown {
  const pm = expr.trim().match(/^(?:\$)?json\.([\w.]+)$/);
  if (pm) return pathGet(item, pm[1]);
  const ev = safeEvaluate(expr.trim(), { json: item });
  if (ev.ok) return ev.value;
  const t = expr.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

// ---- NoOp：原样透传 ----
export const noOpNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    return { main: [...(ctx.inputData?.main ?? [])] };
  },
};

// ---- Error Trigger：仅做透传（本身无数据逻辑） ----
export const errorTriggerNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    return { main: [...(ctx.inputData?.main ?? [])] };
  },
};

// ---- Respond to Webhook：把输入作响应体回显，便于手动运行拿到输出 ----
export const respondToWebhookNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    return {
      main: ctx.inputData?.main?.length ? [...ctx.inputData.main] : [{ json: { responseMode: 'onReceived' } }],
    };
  },
};

// ---- Switch：按规则把输入项路由到命中的分支(s)。 ----
// 引擎采用线性执行模型（单一 main 输出），故把命中任意启用分支的项合并进 main；
// 额外按分支 index 写入 main_branch{N}，便于后续按分支读取。
// n8n switch 参数形态：parameters.rules.values[]，每条 { conditions: { conditions:[ {operator:{operation}, leftValue, rightValue} ] } }；
// 表达式模式：parameters.expression（goToSequential / raw expression）单条真值路由。
export const switchNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters;
    const items = ctx.inputData?.main ?? [];

    // 表达式模式：单条真值表达式决定是否命中
    const expr = p.expression ?? p.rawExpression;
    const isExprMode = !!expr || (p.mode && String(p.mode).toLowerCase().includes('express'));
    if (isExprMode && expr) {
      const out: NodeOutput = { main: [] };
      for (const item of items) {
        const ev = safeEvaluate(String(expr), { json: item.json ?? {} });
        if (ev.ok && Boolean(ev.value)) out.main.push(item);
      }
      return out;
    }

    const groups = p.rules?.values ?? (Array.isArray(p.rules) ? p.rules : []);
    if (!Array.isArray(groups) || groups.length === 0) {
      return { main: items };
    }
    const out: NodeOutput = { main: [] };
    for (const item of items) {
      const j = item.json ?? {};
      let matchedIdx = -1;
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g] ?? {};
        const conds = (group.conditions?.conditions ?? group.conditions ?? group.rules ?? []) as any[];
        let ok = conds.length > 0;
        for (const c of conds) {
          if (c == null) { ok = false; break; }
          const op = (c.operator as any)?.operation ?? (c.operator as any) ?? c.operation ?? 'equals';
          const left = keepType(c.leftValue, j);
          const right = keepType(c.rightValue, j);
          if (!compare(left, op, right)) { ok = false; break; }
        }
        if (ok) { matchedIdx = g; break; }
      }
      if (matchedIdx >= 0) {
        out.main.push(item);
        (out[`main_${matchedIdx}`] ??= []).push(item);
      }
    }
    return out;
  },
};

// ---- Remove Duplicates：按配对字段去重 ----
export const removeDuplicatesNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters;
    const items = ctx.inputData?.main ?? [];
    const pairing = p.options?.pairing?.pairing ?? p.options?.pairing ?? [];
    if (!Array.isArray(pairing) || pairing.length === 0 || items.length < 2) {
      return { main: items };
    }
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const it of items) {
      const j = it.json ?? {};
      const key = pairing.map((pr: any) => {
        const field = String(pr?.field2 ?? pr?.field1 ?? pr?.field ?? '');
        const v = field.split('.').reduce<any>((a: any, k: string) => (a == null ? a : a[k]), j);
        return typeof v === 'string' ? v : JSON.stringify(v);
      }).join('\u0000');
      if (!seen.has(key)) { seen.add(key); out.push(it); }
    }
    return { main: out };
  },
};

// ---- Text Splitter (Recursive Character)：本地真实文本切分 ----
// 把输入文本按 chunkSize 递归切块，chunkOverlap 为相邻块重叠字符数。
export const textSplitterNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters;
    const item = ctx.inputData?.main?.[0]?.json ?? {};
    const chunkSize = Number(p.chunkSize ?? p.chunkOverlap?.chunkSize ?? 4000) || 4000;
    const overlap = Number(p.chunkOverlap ?? 200) || 200;
    // 取被切分的文本：优先 parameters.text 的表达式/字符串，否则 JSON 中第一个字符串字段
    let text = '';
    if (typeof p.text === 'string') {
      const v = keepType(p.text, item);
      text = typeof v === 'string' ? v : JSON.stringify(v ?? '');
    } else {
      const first = Object.values(item).find((v) => typeof v === 'string');
      text = (first as string) ?? '';
    }
    const chunks = splitRecursive(text, chunkSize, overlap);
    return { main: chunks.map((part, i) => ({ json: { output: part, index: i, combined: part } })) };
  },
};

const SEPARATORS = ['\n\n', '\n', ' ', ''];
function splitRecursive(text: string, size: number, overlap: number): string[] {
  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > size) {
    let cut = -1;
    // 优先按分隔符在 [size*0.6, size] 区间找切割点，保证语义完整
    for (const sep of SEPARATORS) {
      const idx = remaining.lastIndexOf(sep, size);
      if (idx > size * 0.6) { cut = idx; break; }
    }
    if (cut < 0) cut = size;
    const piece = remaining.slice(0, cut);
    pieces.push(piece);
    remaining = remaining.slice(Math.max(0, cut - overlap));
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}