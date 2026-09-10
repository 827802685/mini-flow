// console: 极简管理后台
// 页面本体是静态文件 frontend/dist/console.html（由 Workers Assets 托管），
// 这里只提供路由：/console → 转发到该静态页，绕过 n8n SPA fallback。
import type { Context } from 'hono';
import type { Env } from '../types';

export async function consoleRoute(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  if (!env.ASSETS) return c.text('此 Worker 未配置 Static Assets', 500);
  const origin = new URL(c.req.url).origin;
  const res = await env.ASSETS.fetch(new Request(origin + '/console.html'));
  if (res && res.status < 400) {
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
  }
  return c.text('缺少 console.html（把控制面板页面放入 frontend/dist/console.html 并重新部署）', 500);
}