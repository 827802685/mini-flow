// http-request 节点执行器
import type { NodeExecutionContext } from '../types';
import { safeEvaluate } from '../engine/evaluator';

export const httpRequestNode = {
  async execute(ctx: NodeExecutionContext) {
    const p = ctx.node.parameters;
    const method = (p.method ?? 'GET') as string;
    const urlTemplate = String(p.url ?? '');

    // 取当前输入项（n8n: items 数组首个 json）
    const item = ctx.inputData?.main?.[0]?.json ?? {};

    // 支持 {{ $json.foo }} / {{ foo }} 插值
    const url = interpolate(urlTemplate, item);
    const headers: Record<string, string> = {};
    if (p.headerParameters) {
      for (const h of p.headerParameters.parameters ?? []) {
        headers[String(h.name)] = interpValue(h.value, item);
      }
    }

    const body = p.sendBody === true || (p.method && p.method !== 'GET') ? JSON.stringify(fillBody(p, item)) : undefined;

    // P1-5: 网络层错误必须显式抛错（DNS 失败/连接被拒/超时），
    // 而不是吞掉后返回伪造的成功 —— 否则流程明明失败却显示 success。
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : body,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`HTTP 请求失败: ${method} ${url} → ${msg}`);
    }

    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }

    // P1-6: 非 2xx 状态码可配置抛错（n8n HTTP Request "Always Fail On Error" 语义）。
    // 通过节点参数 options.alwaysFailOnError 显式开启；默认保持兼容（返回响应供用户自行判断）。
    const alwaysFail = p.options?.alwaysFailOnError === true || p.alwaysFailOnError === true;
    if (alwaysFail && !res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText || ''}${text ? `: ${text.slice(0, 400)}` : ''}`);
    }

    // n8n 兼容输出：响应体字段合入顶层 $json（$json.args.x 可直接取），
    // 并附加 statusCode/headers/body/json；body 与 json 均指向解析后的响应体。
    const base = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
    return {
      main: [{
        json: {
          ...base,
          statusCode: res.status,
          body: parsed,
          json: parsed,
          headers: Object.fromEntries(res.headers.entries()),
        },
      }],
    };
  },
};

export function interpValue(value: unknown, item: Record<string, any>): string {
  if (typeof value !== 'string') return String(value ?? '');
  return interpolate(value, item);
}

export function interpolate(template: string, item: Record<string, any>): string {
  return template.replace(/\{\{\s*\$?json\.([\w.]+)\s*\}\}|{{\s*([\w.]+)\s*}}/g, (_m, a: string, b: string) => {
    const path = (a ?? b).split('.');
    const v = path.reduce((acc: any, k: string) => (acc == null ? acc : acc[k]), item);
    return v === undefined || v === null ? '' : String(v);
  });
}

function fillBody(p: Record<string, any>, item: Record<string, any>): unknown {
  if (p.jsonBody !== undefined) {
    return JSON.parse(interpolate(JSON.stringify(p.jsonBody), item));
  }
  if (p.bodyParameters) {
    const out: Record<string, string> = {};
    for (const b of p.bodyParameters.parameters ?? []) out[String(b.name)] = interpValue(b.value, item);
    return out;
  }
  return {};
}