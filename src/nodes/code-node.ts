// code-node: Code / Function 节点执行器（受限求值）
// Workers CSP 禁用 new Function，故把 n8n Code 节点的任意 JS 降级为
// 受限表达式求值器(safeEvaluate)：对每个输入项运行参数里的表达式，
// 支持多语句的简单赋值(仅 "const x = expr" / "return expr")，其余走表达式直评。
import type { NodeExecutionContext } from '../types';
import { safeEvaluate } from '../engine/evaluator';

// 提取 Code 节点实际源码：兼容 n8n code/function 常见参数形态
function sourceOf(p: Record<string, any>): string {
  return String(
    p.javascriptCode ?? p.jsCode ?? p.code ?? p.functionCode ?? p.function ?? '',
  );
}

export const codeNode = {
  async execute(ctx: NodeExecutionContext) {
    const p = ctx.node.parameters;
    const code = sourceOf(p).trim();

    // 无源码 → 原样透传（作为 no-op）
    if (!code) {
      return { main: [...(ctx.inputData?.main ?? [])] };
    }

    const inputs = ctx.inputData?.main ?? [];
    if (inputs.length === 0) {
      return { main: [{ json: { output: evalSafe(code, {}) } }] };
    }

    const outputs = inputs.map(({ json }) => {
      try {
        return { json: applyToItem(code, json) };
      } catch (e) {
        return {
          json: { ...json, __codeError: e instanceof Error ? e.message : String(e) },
        };
      }
    });
    return { main: outputs };
  },
};

// 处理单个输入项：多语句赋值 / return / 单表达式
function applyToItem(code: string, item: Record<string, any>): Record<string, any> {
  const ctx = { json: item, env: {} };

  // "const/let x = expr; return expr" 形态 → 顺序求值，最后 return/末行作为输出值
  if (code.includes('return ') || /\b(const|let)\s+/.test(code)) {
    const result = runStatementBody(code, item);
    // 单输出：若结果为普通对象且含未引用字段仅当是返回构造；否则原样
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      const keys = Object.keys(result);
      const hasNewKey = keys.length === 1 && !(keys[0] in item);
      if (!hasNewKey) return { ...item, ...result };
      return { output: (result as Record<string, unknown>)[keys[0]] };
    }
    return { ...item, output: result };
  }

  // 单表达式
  const v = evalSafe(code, item);
  // 可能返回完整对象：若是映射自 item 字段的 prompt 等，交给调用方判断
  if (v !== undefined) return { ...item, output: v };
  return item;
}

// 受限多语句执行：仅支持 const/let 单赋值 + return，构建隔离作用域
function runStatementBody(code: string, item: Record<string, any>): unknown {
  const scope: Record<string, unknown> = { ...item };
  const stmts = code.split(/;\s*(?=(?:const|let|return|$))/).filter((s) => s.trim());
  let last: unknown = undefined;
  for (const raw of stmts) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith('return')) {
      const ret = s.replace(/^return\s+/, '').trim();
      return evalSafe(ret, { json: { ...item, ...scope }, env: {} });
    }
    const m = s.match(/^(?:const|let|var)\s+([\w$]+)\s*=\s*([\s\S]+)$/);
    if (m) {
      scope[m[1]] = evalSafe(m[2], { json: { ...item, ...scope }, env: {} });
      last = scope[m[1]];
      continue;
    }
    last = evalSafe(s, { json: { ...item, ...scope }, env: {} });
  }
  return last;
}

function evalSafe(code: string, item: Record<string, any>): unknown {
  const ev = safeEvaluate(code, { json: item, env: {} });
  if (ev.ok) return ev.value;
  // 字母序兜底：原样广播并标注错误
  return { __codeError: ev.error };
}