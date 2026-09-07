// index.ts: Worker 入口
// 装配 Hono：/rest/* 走 n8n REST 适配层；/push 转发到 Durable Object SSE；
// SPA fallback 托管 n8n editor-ui dist；cron 触发定时扫描恢复。
import { Hono } from 'hono';
import type { Env } from './types';
import { restApi } from './n8n/router';
import { sendPush } from './n8n/push';
import { cleanupStaleLocks } from './engine/lock';
import { listPending, purgeDeadLetter } from './engine/dead-letter';

const app = new Hono<{ Bindings: Env }>();

// --- n8n REST 适配层 ---
app.route('/rest', restApi);

// --- Push SSE：转发到 Durable Object，建立 EventSource ---
app.get('/push', async (c) => {
  const id = c.env.PUSH.idFromName('main');
  const stub = c.env.PUSH.get(id);
  // 用 DO 能力子请求打开 SSE（透传）
  return stub.fetch(new Request('https://do/push', { headers: c.req.raw.headers }));
});

// --- 静态资源托管 + SPA fallback（n8n editor-ui dist） ---
app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  // 跳过 API
  if (path.startsWith('/rest') || path === '/push') return c.notFound();

  const reqUrl = path.startsWith('/assets') ? path : '/index.html';
  const asset = await fetchAsset(reqUrl);
  if (asset) return new Response(asset.body, {
    status: 200,
    headers: { 'Content-Type': contentTypeFor(reqUrl), 'Cache-Control': reqUrl.startsWith('/assets') ? 'public, max-age=31536000, immutable' : 'no-cache' },
  });
  // 未托管的走 SPA fallback（返回 index.html 让前端路由接管）
  const idx = await fetchAsset('/index.html');
  if (idx) return new Response(idx.body, { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response('mini-flow worker: put editor-ui dist in public/assets', { status: 200, headers: { 'Content-Type': 'text/html' } });
});

// 静态资源抽象：骨架阶段返回占位；接入时把 n8n editor-ui dist 放入 public/ 并实现读取。
async function fetchAsset(_path: string): Promise<Response | null> {
  // TODO: 接入 n8n editor-ui 构建产物后，改为从 public/assets 读取真实文件。
  return null;
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  return 'text/plain';
}

// --- Cron: 每 15 分钟 - 清理过期锁 + 扫描 DLQ + 清理死信 ---
const CLEANUP_CRON = async (env: Env) => {
  await cleanupStaleLocks(env).catch(() => 0);
  const pending = await listPending(env, 20).catch(() => []);
  for (const dlq of pending) {
    // TODO: 从 DLQ 重建执行并 retry（需工作流数据路径），骨架先占位。
    await sendPush(env, { type: 'executionWaiting', executionId: dlq.execution_id });
  }
  await purgeDeadLetter(env).catch(() => 0);
};

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    if (controller.cron === '*/15 * * * *') {
      await CLEANUP_CRON(env);
    }
  },
};