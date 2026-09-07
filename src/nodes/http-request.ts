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

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : body,
    });

    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }

    return {
      main: [{ json: { statusCode: res.status, body: parsed, json: parsed, headers: Object.fromEntries(res.headers.entries()) } }],
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