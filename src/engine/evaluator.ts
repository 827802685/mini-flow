// 受限表达式求值器（替代 n8n Function 节点的 new Function）
// Cloudflare Workers 由 CSP 硬性禁用 eval() / new Function，因此用
// 白名单 token 分词器 + 递归下降求值器 实现安全表达式求值。
// 支持: 字段引用(json.foo / $json.foo)、数字/字符串/布尔/数组字面量、
//       比较(== != > >= < <=)、逻辑(&& || !)、三目、算术、括号。
// 内置函数库见 BUILTIN_FUNCTIONS（均为可恢复/确定性实现）。

import type { EvalContext } from '../types';

export class EvalSyntaxError extends Error {
  constructor(msg: string) {
    super(`[eval] ${msg}`);
    this.name = 'EvalSyntaxError';
  }
}

// ---------- 分词器 ----------
type TokenType =
  | 'number' | 'string' | 'ident' | 'op' | 'lparen' | 'rparen'
  | 'comma' | 'lbrace' | 'rbrace' | 'lbracket' | 'rbracket' | 'dot';

interface Token {
  type: TokenType;
  value: string;
}

const SYMBOLS = new Set(['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '+', '-', '*', '/', '!', '?', ':']);
const SINGLE = new Set(['(', ')', ',', '{', '}', '[', ']', '.']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch; let j = i + 1; let out = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) { out += src[j + 1]; j += 2; continue; }
        out += src[j]; j++;
      }
      if (j >= n) throw new EvalSyntaxError('未闭合的字符串');
      tokens.push({ type: 'string', value: out });
      i = j + 1; continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < n && /[\d.]/.test(src[j])) j++;
      tokens.push({ type: 'number', value: src.slice(i, j) });
      i = j; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j; continue;
    }
    const three = src.slice(i, i + 3);
    if (SYMBOLS.has(three)) { tokens.push({ type: 'op', value: three }); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (SYMBOLS.has(two)) { tokens.push({ type: 'op', value: two }); i += 2; continue; }
    if (SYMBOLS.has(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
    if (SINGLE.has(ch)) {
      const map: Record<string, TokenType> = { '(': 'lparen', ')': 'rparen', ',': 'comma', '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket', '.': 'dot' };
      tokens.push({ type: map[ch], value: ch });
      i++; continue;
    }
    throw new EvalSyntaxError(`无法识别的字符: ${ch}`);
  }
  return tokens;
}

// ---------- 递归下降解析器 / 求值器 ----------
class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private ctx: EvalContext) {}

  parse(): unknown {
    const v = this.ternary();
    if (this.pos < this.tokens.length) throw new EvalSyntaxError('意外的多余输入');
    return v;
  }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expect(type: TokenType): Token {
    const t = this.next();
    if (t.type !== type) throw new EvalSyntaxError(`期望 ${type}，得到 ${t.type}(${t.value})`);
    return t;
  }
  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return !!t && t.type === 'op' && ops.includes(t.value);
  }

  // a ? b : c  （条件三元）
  private ternary(): unknown {
    const cond = this.logicalOr();
    if (this.peek()?.type === 'op' && this.peek()?.value === '?') {
      this.next();
      const a = this.ternary();
      const t = this.next();
      if (t.type !== 'op' || t.value !== ':') throw new EvalSyntaxError('三元表达式缺少冒号');
      const b = this.ternary();
      return cond ? a : b;
    }
    return cond;
  }

  private logicalOr(): unknown {
    let l = this.logicalAnd();
    while (this.isOp('||')) { this.next(); const r = this.logicalAnd(); l = Boolean(l) || Boolean(r); }
    return l;
  }
  private logicalAnd(): unknown {
    let l = this.equality();
    while (this.isOp('&&')) { this.next(); const r = this.equality(); l = Boolean(l) && Boolean(r); }
    return l;
  }
  private equality(): unknown {
    let l = this.comparison();
    while (this.isOp('==', '!=', '===', '!==')) {
      const op = this.next().value;
      const r = this.comparison();
      // === / !== 视作与 == / != 相同的宽松等价（数字与数字字符串互通）
      l = op === '===' || op === '==' ? looseEq(l, r) : !looseEq(l, r);
    }
    return l;
  }
  private comparison(): unknown {
    let l = this.additive();
    while (this.isOp('>', '>=', '<', '<=')) {
      const op = this.next().value;
      const r = this.additive();
      const a = Number(l), b = Number(r);
      l = op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
    }
    return l;
  }
  private additive(): unknown {
    let l = this.multiplicative();
    while (this.isOp('+', '-')) {
      const op = this.next().value;
      const r = this.multiplicative();
      l = applyAdditive(op, l, r);
    }
    return l;
  }
  private multiplicative(): unknown {
    let l = this.unary();
    while (this.isOp('*', '/')) {
      const op = this.next().value;
      const r = this.unary();
      l = op === '*' ? Number(l) * Number(r) : Number(l) / Number(r);
    }
    return l;
  }
  private unary(): unknown {
    if (this.isOp('!')) { this.next(); return !this.unary(); }
    if (this.isOp('-')) { this.next(); return -Number(this.unary()); }
    return this.primary();
  }
  private primary(): unknown {
    const t = this.next();
    switch (t.type) {
      case 'number': return Number(t.value);
      case 'string': return t.value;
      case 'ident':
        if (this.peek()?.type === 'lparen') return this.call(t.value);
        return this.primaryIdent(t.value);
      case 'lparen': { const v = this.ternary(); this.expect('rparen'); return this.chain(v); }
      case 'lbracket': { const arr: unknown[] = []; if (this.peek()?.type !== 'rbracket') { arr.push(this.ternary()); while (this.peek()?.type === 'comma') { this.next(); arr.push(this.ternary()); } } this.expect('rbracket'); return this.chain(arr); }
      case 'lbrace': { const obj: Record<string, unknown> = {}; if (this.peek()?.type !== 'rbrace') { while (true) { const k = this.next(); const key = k.type === 'string' ? k.value : k.type === 'ident' ? k.value : ''; const colon = this.next(); if (colon.type !== 'op' || colon.value !== ':') throw new EvalSyntaxError('对象缺少冒号'); const v = this.ternary(); obj[key] = v; if (this.peek()?.type === 'comma') { this.next(); continue; } break; } } this.expect('rbrace'); return obj; }
      case 'dot': { const prop = this.next(); if (prop.type !== 'ident') throw new EvalSyntaxError('点号后需为字段名'); return getPath(this.ctx, [prop.value]); }
      default: throw new EvalSyntaxError(`意外的 token: ${t.value}`);
    }
  }

  private call(name: string): unknown {
    this.expect('lparen');
    const args: unknown[] = [];
    if (this.peek()?.type !== 'rparen') {
      args.push(this.ternary());
      while (this.peek()?.type === 'comma') { this.next(); args.push(this.ternary()); }
    }
    this.expect('rparen');
    const fn = lookupFunction(name);
    if (!fn) throw new EvalSyntaxError(`未知函数: ${name}`);
    return fn(args, this.ctx);
  }

  // 从上下文取值：ident 为 $json/json/env/+ 或裸字段名（支持点链访问 json.a.b）
  private lookup(name: string): unknown {
    if (name === 'json' || name === '$json') return this.ctx.json;
    if (name === 'env') return this.ctx.env;
    if (name === '$now') return this.ctx.$now ?? new Date().toISOString();
    // 裸字段名 → 从当前 json 项取
    return getNested(this.ctx.json, name.split('.'));
  }

  // 支持属性链的 primary：$json.args.x / json.a.b / env.k / 裸字段 x.y.z / 任意值.field
  private primaryIdent(name: string): unknown {
    return this.chain(this.lookup(name));
  }

  // 链式成员访问：x.a.b / (expr).field / [arr].length 等，点号后需为字段名
  private chain(base: unknown): unknown {
    let val = base;
    while (this.peek()?.type === 'dot') {
      this.next();
      const prop = this.next();
      if (prop.type !== 'ident') throw new EvalSyntaxError('点号后需为字段名');
      val = val == null || typeof val !== 'object' ? undefined : (val as Record<string, unknown>)[prop.value];
    }
    return val;
  }
}

function oneToken(t: Token): string { return t.type === 'string' ? `'${t.value}'` : t.value; }

function getPath(ctx: EvalContext, parts: string[]): unknown {
  return getNested(ctx.json, parts);
}

function getNested(base: unknown, parts: string[]): unknown {
  let cur = base;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'string' && b !== '' && !isNaN(Number(b))) return a === Number(b);
  return String(a) === String(b);
}

// 真 JS 语义（修复 1+1="11"）：number+number 数值相加；任一操作数为字符串则拼接；
// 其余(null/boolean 等)与减法一致走数值运算，符合 JS ToPrimitive 回落。
function applyAdditive(op: string, l: unknown, r: unknown): unknown {
  if (op === '-') return Number(l) - Number(r);
  if (typeof l === 'number' && typeof r === 'number') return l + r;
  if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
  return Number(l) + Number(r);
}

// ---------- 内置函数库（白名单，禁止任意代码） ----------
const BUILTIN_FUNCTIONS: Record<string, (args: unknown[], ctx: EvalContext) => unknown> = {
  round: (a) => Math.round(Number(a[0]) * (10 ** Number(a[1] ?? 0))) / (10 ** Number(a[1] ?? 0)),
  floor: (a) => Math.floor(Number(a[0])),
  ceil: (a) => Math.ceil(Number(a[0])),
  abs: (a) => Math.abs(Number(a[0])),
  max: (a) => Math.max(...a.map(Number)),
  min: (a) => Math.min(...a.map(Number)),
  length: (a) => {
    const v = a[0];
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.length;
    return 0;
  },
  upper: (a) => String(a[0]).toUpperCase(),
  lower: (a) => String(a[0]).toLowerCase(),
  trim: (a) => String(a[0]).trim(),
  concat: (a) => a.map(String).join(''),
  toInt: (a) => parseInt(String(a[0]), 10),
  toFloat: (a) => parseFloat(String(a[0])),
  substr: (a) => String(a[0]).substr?.(Number(a[1]), Number(a[2] ?? undefined)),
  dateFormat: (a) => {
    const d = a[0] ? new Date(String(a[0])) : new Date();
    return d.toISOString();
  },
  uppercase: (a) => String(a[0]).toUpperCase(),
};

function lookupFunction(name: string) {
  return BUILTIN_FUNCTIONS[name];
}

// ---------- 公开入口 ----------
export function evaluate(expression: string, ctx: EvalContext): unknown {
  const tokens = tokenize(expression);
  if (tokens.length === 0) return undefined;
  return new Parser(tokens, ctx).parse();
}

export { BUILTIN_FUNCTIONS };

// 捕获一次求值中出现的语法/求值错误，便于节点层统一处理
export function safeEvaluate(expression: string, ctx: EvalContext): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: evaluate(expression, ctx) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}