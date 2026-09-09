// transform-nodes: 数据转换/工具类节点执行器
// 为 mini-flow 补全常用可真实执行的数据节点：
// Filter / Sort / Aggregate / Math / DateTime / ExtractFromJson / EditFields(Set多字段) / Convert协信。
// 命名统一 node.xxx 前缀匹配 n8n 参数形态，worker 受限环境下保持确定性、幂等实现。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

function getPath(obj: any, path: string): unknown {
  return String(path).split('.').reduce<any>((a, k) => (a == null ? a : a[k]), obj);
}
function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// ---- Filter：按 expression 求值保留为 true 的项 ----
// n8n filter params.conditions.conditions[{operator,leftValue,rightValue}] 或 expression
export const filterNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const conditions = p.conditions?.conditions ?? p.conditions ?? [];
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return { main: items };
    }
    const out = items.filter((it) => {
      const j = it.json ?? {};
      for (const c of conditions) {
        if (c.expression) return isTruthy(evalExprOf(c.expression, j));
        const op = c.operator ?? 'equal';
        const left = keepVal(c.leftValue, j);
        const right = keepVal(c.rightValue, j);
        if (!filterCompare(left, op, right)) return false;
      }
      return true;
    });
    return { main: out };
  },
};

// ---- Sort：按 fields 排序 ----
// n8n sort rules.rules[{field, type}]；type=ascending/descending
export const sortNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = [...(ctx.inputData?.main ?? [])];
    const rules = p.rules?.rules ?? p.sortBy ?? [];
    if (!Array.isArray(rules) || rules.length === 0) return { main: items };
    items.sort((a, b) => {
      for (const r of rules) {
        const field = r.field ?? r.name;
        const dir = (r.type ?? r.direction ?? 'ascending').toLowerCase().startsWith('desc') ? -1 : 1;
        const av = getPath(a.json, field);
        const bv = getPath(b.json, field);
        let cmp = 0;
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
    return { main: items };
  },
};

// ---- Aggregate：按 grouping 分组并聚合 (sum/count/avg/min/max) ----
// n8n aggregation.fields[{field,aggregation,grouping}]；分组标记项宣告分组字段，其余为聚合子项。
export const aggregateNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const fields = Array.isArray(p.fields) ? p.fields : (p.aggregation?.fields ?? []);
    const groupEntry = fields.find((f: any) => f.grouping);
    const groupField = groupEntry ? String(groupEntry.field ?? '') : '';
    const groups: Record<string, Item[]> = {};
    if (groupField) {
      for (const it of items) {
        const k = String(getPath(it.json, groupField) ?? '');
        (groups[k] ??= []).push(it);
      }
    } else {
      groups['__all'] = items;
    }
    const out: Item[] = [];
    for (const [gkey, gitems] of Object.entries(groups)) {
      const agg: Record<string, any> = {};
      if (groupField) agg[groupField] = isNaN(Number(gkey)) ? gkey : (gkey === '' ? gkey : num(gkey));
      for (const f of fields as any[]) {
        const field = f.field;
        if (f.grouping) continue; // 分组字段本身不聚合
        if (Array.isArray(f.subFields)) {
          for (const sf of f.subFields) agg[String(sf.field ?? field)] = doAgg(sf.aggregation, sf.field, gitems);
        } else if (field && f.aggregation) {
          agg[String(field)] = doAgg(f.aggregation, field, gitems);
        }
      }
      out.push({ json: agg });
    }
    return { main: out };
  },
};
function doAgg(fn: string, field: string, items: Item[]): unknown {
  const fn0 = String(fn ?? '').toLowerCase();
  const vals = items.map((i) => num(getPath(i.json, field)));
  if (fn0 === 'count') return items.length;
  if (fn0.startsWith('sum')) return vals.reduce((a, b) => a + b, 0);
  if (fn0.startsWith('avg') || fn0.startsWith('mean')) return items.length ? vals.reduce((a, b) => a + b, 0) / items.length : 0;
  if (fn0.startsWith('min')) return items.length ? Math.min(...vals) : undefined;
  if (fn0.startsWith('max')) return items.length ? Math.max(...vals) : undefined;
  return items.length;
}

// ---- Math：执行单个数学表达式 ----
// n8n math.values 逐项求值；此处对每个输入项支持 {{ }} / 裸 js 表达式求值(底层受限求值器不支持则 demo 四则)
export const mathNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const expr = p.expression ?? p.formula ?? '';
    if (!expr) return { main: items };
    const out = items.map((it) => {
      const j = it.json ?? {};
      const formula = interpMath(expr, j);
      const result = safeArith(formula);
      return { json: { ...j, result } };
    });
    return { main: out };
  },
};
function interpMath(tpl: string, item: Record<string, any>): string {
  return tpl.replace(/\{\{\s*\$?json\.([\w.]+)\s*\}\}|{{\s*([\w.]+)\s*}}/g, (_m, a, b) => {
    const v = getPath(item, (a ?? b));
    return v === undefined ? '0' : String(typeof v === 'number' ? v : num(v));
  });
}
function safeArith(s: string): number | string {
  const cleaned = s.replace(/[^0-9+\-*/().\s]/g, '').trim();
  if (!cleaned) return s;
  const result = new MathParser(cleaned).parse();
  return result === null ? s : result;
}

// 受限四则解析器：仅支持 + - * / ( ) 与十进制数字，禁止 eval/new Function。
class MathParser {
  private tokens: string[];
  private pos = 0;
  constructor(src: string) { this.tokens = src.match(/\d+\.?\d*|[+\-*/().]/g) ?? []; }
  parse(): number | null {
    try { return this.expr(); } catch { return null; }
  }
  private peek(): string | undefined { return this.tokens[this.pos]; }
  private next(): string { return this.tokens[this.pos++]; }
  private expr(): number { return this.addSub(); }
  private addSub(): number {
    let v = this.mulDiv();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.next();
      const r = this.mulDiv();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  private mulDiv(): number {
    let v = this.factor();
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.next();
      const r = this.factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  private factor(): number {
    const t = this.next();
    if (t === '(') {
      const v = this.expr();
      if (this.next() !== ')') throw new Error('括号不匹配');
      return v;
    }
    if (t === '-') return -this.factor();
    if (t === undefined) throw new Error('缺操作数');
    return parseFloat(t);
  }
}

// ---- Date / Time：格式化/加减日期 ----
export const dateTimeNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const out = items.map((it) => {
      const j = it.json ?? {};
      const base = p.dateProperty ? new Date(String(getPath(j, p.dateProperty) ?? Date.now())) : new Date();
      if (isNaN(base.getTime())) return { json: j };
      const addT = p.additionalFields?.add ?? {};
      const target = new Date(base);
      const amt = num(addT.value ?? 0);
      if (amt) {
        if (addT.unit === 'days') target.setDate(target.getDate() + amt);
        else if (addT.unit === 'hours') target.setHours(target.getHours() + amt);
        else if (addT.unit === 'minutes') target.setMinutes(target.getMinutes() + amt);
        else if (addT.unit === 'weeks') target.setDate(target.getDate() + amt * 7);
        else if (addT.unit === 'months') target.setMonth(target.getMonth() + amt);
        else if (addT.unit === 'years') target.setFullYear(target.getFullYear() + amt);
        else if (addT.unit === 'milliseconds') target.setMilliseconds(target.getMilliseconds() + amt);
      }
      return { json: { ...j, result: target.toISOString() } };
    });
    return { main: out };
  },
};

// ---- Extract from JSON：从 JSON 字符串提取字段 ----
export const extractJsonNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const srcField = p.sourceKey ?? p.dataPropertyName ?? 'json';
    const out = items.flatMap((it) => {
      const j = it.json ?? {};
      const raw = getPath(j, srcField);
      let parsed: unknown;
      try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { parsed = raw; }
      if (Array.isArray(parsed)) return parsed.map((x) => ({ json: { ...j, json: x } }));
      if (parsed && typeof parsed === 'object') return [{ json: { ...j, ...(parsed as Record<string, any>) } }];
      return [{ json: j }];
    });
    return { main: out };
  },
};

// ---- Edit Fields (Set)：多字段写入 ----
export const editFieldsNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const fields = p.fields ?? p.assignments ?? [];
    const mode = p.mode ?? (p.fields ? 'merge' : 'set');
    const out = items.map((it) => {
      let j = { ...(it.json ?? {}) };
      for (const f of (fields as any[])) {
        const key = f.name ?? f.field;
        if (!key) continue;
        if (mode === 'set') j[key] = keepVal(f.value, j);
        else j[key] = keepVal(f.value, j); // merge 同 set
      }
      return { json: j };
    });
    return { main: out };
  },
};

// ---- helpers ----
// 解析 n8n 值形态：={{ json.x }} / {{ $json.x }} / {{ json.x }} / 裸 json.x，其余为字面量
function keepVal(v: unknown, item: Record<string, any>): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  const m = t.match(/^=\{\{\s*\$?json\.([\w.]+)\s*\}\}\s*$/);
  if (m) return getPath(item, m[1]) ?? null;
  const m2 = t.match(/^\{\{\s*\$?json\.([\w.]+)\s*\}\}\s*$/);
  if (m2) return getPath(item, m2[1]) ?? null;
  const bare = t.match(/^\$?json\.([\w.]+)$/);
  if (bare) return getPath(item, bare[1]);
  if (t.includes('{{') || t.startsWith('=')) {
    const inner = t.replace(/^=\{\{\s*/, '').replace(/\s*\}\}\s*$/, '');
    const im = inner.match(/^\$?json\.([\w.]+)$/);
    if (im) return getPath(item, im[1]);
    return t;
  }
  return v;
}
function evalExprOf(expr: string, item: Record<string, any>): unknown {
  const m = expr.match(/^\{\{\s*\$?json\.([\w.]+)\s*\}\}$/);
  if (m) return getPath(item, m[1]) ?? '';
  return expr;
}
function isTruthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return String(v).length > 0;
}
function filterCompare(left: unknown, op: string, right: unknown): boolean {
  const L: any = left; const R: any = right;
  const ln = num(L), rn = num(R);
  const bothNum = L !== '' && R !== '' && !isNaN(Number(L)) && !isNaN(Number(R)) && !['equal','notEqual','exists','notExists','contains','notContains'].includes(op);
  switch (op) {
    case 'equal': case 'equals': case '==': return String(L) === String(R);
    case 'notEqual': case 'notEquals': case '!=': return String(L) !== String(R);
    case 'gt': case '>': return bothNum ? ln > rn : (L as any) > (R as any);
    case 'gte': case '>=': return bothNum ? ln >= rn : (L as any) >= (R as any);
    case 'lt': case '<': return bothNum ? ln < rn : (L as any) < (R as any);
    case 'lte': case '<=': return bothNum ? ln <= rn : (L as any) <= (R as any);
    case 'contains': case 'includes': return String(L).includes(String(R));
    case 'notContains': return !String(L).includes(String(R));
    case 'startsWith': return String(L).startsWith(String(R));
    case 'endsWith': return String(L).endsWith(String(R));
    case 'exists': case 'isNotEmpty': return L != null && L !== '';
    case 'notExists': return L == null || L === '';
    case 'isEmpty': return L === '' || L == null;
    default: return String(L) === String(R);
  }
}