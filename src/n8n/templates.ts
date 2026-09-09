// templates: 把模板 API 请求代理到 n8n 模板市场(api.n8n.io)
// 前端模板页实际调用的是同源的 /templates/*（categories / search / collections / {id}），
// 以及个别场景带 /rest 前缀的 /rest/templates/*。两者都落到本代理转发到真实模板库并透传 JSON，
// 否则会落入 SPA fallback 返回 HTML，前端解析失败报 "problem fetching workflow templates"。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';

const TEMPLATES_HOST = 'https://api.n8n.io/api/';

// /rest 挂载用的子应用：把 /rest/templates/* 全部走同一代理 handler
export const templatesRoutes = new Hono<{ Bindings: Env }>()
  .all('*', (c) => templateProxyHandler(c));

// 可复用代理 handler：
//  - 根挂载（/templates/*）时 pathname=/templates/search；
//  - /rest 挂载（/rest/templates/*）时 pathname=/rest/templates/search。
// 统一抽出 "/templates/..." 段，作为上游路径的一部分(上游 = api/templates/search)。
export async function templateProxyHandler(c: Context<{ Bindings: Env }>) {
  const url = new URL(c.req.url);
  const p = url.pathname;
  // 编辑器导入模板(/workflows/templates/{id}) → 返回可导入 n8n workflow（展开内层），
  // 其余(/templates/* 详情预览、search、categories…) → 原样透传上游。
  const isImport = /\/workflows\/templates\/\d+/.test(p);
  // 定位 "/templates" 起始位置，取出其后内容作为上游子路径。
  const ti = p.indexOf('/templates');
  let sub = ti >= 0 ? p.slice(ti) : '/'; // /templates/search 或 /templates/11807
  const qs = url.search;
  // 详情端点：n8n 模板库取单个模板的正确路径是 api/templates/workflows/{id}，
  // 而非 api/templates/{id}。前端 /templates/{id}（或 /rest/templates/{id}）会命中本代理，
  // 需把纯 ID 形态改写为 /templates/workflows/{id}，否则上游 404。
  const m = sub.match(/^\/templates\/(\d+)\/?$/);
  if (m) sub = `/templates/workflows/${m[1]}`;
  const upstream = TEMPLATES_HOST + sub.replace(/^\/+/, '') + qs;
  try {
    const up = await fetch(upstream, {
      headers: { accept: 'application/json', 'user-agent': 'mini-flow' },
    });
    let text = await up.text();
    const ct = up.headers.get('content-type') ?? 'application/json; charset=utf-8';
    // 导入模式：上游详情 { workflow: { name, nodes…, workflow:{meta,nodes,connections,…} } }。
    // 前端 fetchTemplateById 取 resp.workflow 直接填充画布，故把可导入工作流提升到 top-level，
    // 缺的 nodes/connections 从内层 workflow.workflow 补全，保证画布渲染完整。
    if (isImport && up.ok && up.headers.get('content-type')?.includes('json')) {
      try {
        const j = JSON.parse(text);
        const wf = j?.workflow;
        if (wf) {
          const inner = wf.workflow && typeof wf.workflow === 'object' ? wf.workflow : null;
          const importable = {
            name: wf.name ?? inner?.meta?.name ?? 'Imported workflow',
            nodes: (inner?.nodes && inner.nodes.length) ? inner.nodes : (wf.nodes ?? []),
            connections: inner?.connections ?? wf.connections ?? {},
            active: false,
          };
          text = JSON.stringify({ workflow: importable });
        }
      } catch (_e) { /* 保留原样 */ }
    }
    return new Response(text, { status: up.status, headers: { 'content-type': ct } });
  } catch (err) {
    return c.json({ code: 502, message: 'Template upstream unreachable', data: undefined }, 502);
  }
}