// index.ts: Worker 入口
// 装配 Hono：/rest/* 走 n8n REST 适配层；/push 转发到 Durable Object SSE；
// SPA fallback 托管 n8n editor-ui dist；cron 触发定时扫描恢复。
import { Hono } from 'hono';
import type { Env } from './types';
import { restApi } from './n8n/router';
import { sendPush } from './n8n/push';
import { cleanupStaleLocks } from './engine/lock';
import { listPending, purgeDeadLetter, rebuildFromDlq } from './engine/dead-letter';

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

// --- 静态资源托管 + SPA fallback（n8n editor-ui dist，经 Workers Static Assets） ---
app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/+/, '');
  // 跳过 API 与 Push
  if (path === '' || !c.env.ASSETS) {
    // 有 Assets 时交给它处理；无则返回接入提示
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text('mini-flow worker: 未配置 ASSETS（把 n8n editor-ui dist 放入 frontend/dist 并开启 assets）');
  }
  const asset = await c.env.ASSETS.fetch(new Request(new URL(c.req.url).origin + '/' + path, c.req.raw));
  // 命中真实资源 → 直接返回；否则 SPA fallback 到 index.html
  if (asset && !asset.status.toString().startsWith('4')) return asset;
  const idx = await c.env.ASSETS.fetch(new Request(new URL(c.req.url).origin + '/index.html'));
  if (idx) return new Response(idx.body, { status: 200, headers: { 'Content-Type': 'text/html' } });
  return c.text('mini-flow worker: 未找到 index.html');
});

// --- Cron: 每 15 分钟 - 清理过期锁 + DLQ 自动补偿扫描 + 清理死信 ---
const CLEANUP_CRON = async (env: Env) => {
  await cleanupStaleLocks(env).catch(() => 0);
  // 扫描到期的 pending 死信，逐条重建执行并重投 FlowEngine
  const pending = await listPending(env, 20).catch(() => []);
  for (const dlq of pending) {
    const r = await rebuildFromDlq(env, dlq).catch(() => ({ ok: false, newExecutionId: undefined, error: 'rebuild failed' }));
    if (r.ok && r.newExecutionId) {
      await sendPush(env, { type: 'executionStarted', executionId: r.newExecutionId });
    } else {
      await sendPush(env, { type: 'executionWaiting', executionId: dlq.execution_id });
    }
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

// 必须从入口导出 Durable Object 与 Workflows 类，否则 wrangler 无法绑定。
export { PushConnection } from './runtime/push';
export { FlowEngine } from './runtime/flow-engine';