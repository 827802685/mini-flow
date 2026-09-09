// set / if 节点执行器
import type { NodeExecutionContext } from '../types';
import { safeEvaluate } from '../engine/evaluator';

// ---- Set：写入字段 ----
export const setNode = {
  async execute(ctx: NodeExecutionContext) {
    const p = ctx.node.parameters;
    const item = { ...(ctx.inputData?.main?.[0]?.json ?? {}) };

    if (p.assignments) {
      for (const a of p.assignments.assignments ?? []) {
        item[String(a.name)] = interpKeepType(a.value, ctx.inputData?.main?.[0]?.json ?? {});
      }
    } else if (p.name !== undefined) {
      item[String(p.name)] = interpKeepType(p.value, item);
    }
    return { main: [{ json: item }] };
  },
};

function interpKeepType(value: unknown, item: Record<string, any>): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  const em = t.match(/^=\{\{\s*([\s\S]*?)\s*\}\}\s*$/);
  if (em) {
    const ppt = em[1].trim().match(/^(?:\$)?json\.([\w.]+)$/);
    if (ppt) return ppt[1].split('.').reduce<any>((a, k) => (a == null ? a : a[k]), item);
    const ev = safeEvaluate(em[1].trim(), { json: item });
    return ev.ok ? ev.value : em[1].trim();
  }
  const m = value.match(/^\s*\{\{\s*\$?json\.([\w.]+)\s*\}\}\s*$/);
  if (m) {
    const v = m[1].split('.').reduce<any>((a, k) => (a == null ? a : a[k]), item);
    return v === undefined ? null : v;
  }
  if (value.includes('{{') || value.startsWith('=')) {
    const ev = safeEvaluate(t, { json: item });
    if (ev.ok) return ev.value;
  }
  return value;
}

// ---- IF：条件分支 ----
// n8n IF 输出 main[0]=true 分支, main[1]=false 分支
export const ifNode = {
  async execute(ctx: NodeExecutionContext) {
    const p = ctx.node.parameters;
    const item = ctx.inputData?.main?.[0]?.json ?? {};
    let result: boolean = false;

    if (p.conditions) {
      // 条件组 model 优先
      for (const c of p.conditions.conditions ?? []) {
        if (c.leftValue == null) continue;
        const left = interpKeepType(c.leftValue, item);
        const right = interpKeepType(c.rightValue, item);
        if (compare(left, c.operator, right)) { result = true; break; }
      }
    } else if (typeof p.expression === 'string') {
      const ev = safeEvaluate(p.expression, { json: item });
      result = ev.ok ? Boolean(ev.value) : false;
    } else if (p.field !== undefined) {
      result = compare(interpKeepType(p.value, item), p.operator ?? 'equals', ((x: any) => x)(p.conditionValue));
    }

    return result
      ? { main: [{ json: item }], branch: true }
      : { main: [], branch: false };
  },
};

export function compare(left: unknown, operator: string, right: unknown): boolean {
  const L: any = left, R: any = right;
  // 保守的数值比较：尽量转数字
  const ln = Number(L), rn = Number(R);
  const bothNum = L !== '' && R !== '' && !isNaN(ln) && !isNaN(rn) && (operator !== 'equal' && operator !== 'equals' && operator !== 'notEqual' && operator !== '==' && operator !== '!=');
  switch (operator) {
    case 'equal': case 'equals': case '==': return String(L) === String(R);
    case 'notEqual': case 'notEquals': case '!=': return String(L) !== String(R);
    case 'gt': case '>': return (bothNum ? ln : String(L)) > (bothNum ? rn : String(R));
    case 'gte': case '>=': return L >= R;
    case 'lt': case '<': return L < R;
    case 'lte': case '<=': return L <= R;
    case 'contains': return String(L).includes(String(R));
    case 'notContains': return !String(L).includes(String(R));
    case 'startsWith': return String(L).startsWith(String(R));
    case 'endsWith': return String(L).endsWith(String(R));
    case 'isEmpty': return L === '' || L == null;
    case 'isNotEmpty': return L !== '' && L != null;
    default: return String(L) === String(R);
  }
}