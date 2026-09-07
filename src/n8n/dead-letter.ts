// dead-letter: n8n REST 死信管理路由
// 供前端（或人工运维）查看/手动重试死信条目，以及查看自动补偿状态。
import { Hono } from 'hono';
import type { Env } from '../types';
import { withRetry } from '../engine/retry';
import { listPending, requeueDeadLetter, resolveDeadLetter, rebuildFromDlq } from '../engine/dead-letter';

export const dlqRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/dead-letter?status=pending|failed|resolved
  .get('/', async (c) => {
    const status = c.req.query('status') ?? 'pending';
    const limit = Math.min(100, Number(c.req.query('limit') ?? 50));
    const res = await withRetry(() => c.env.DB.prepare(
      "SELECT * FROM dead_letter_queue WHERE status=? ORDER BY created_at ASC LIMIT ?",
    ).bind(status, limit).all<any>());
    return c.json({ data: res.results.map(toView) });
  })
  // GET /rest/dead-letter/:id
  .get('/:id', async (c) => {
    const row = await getDlq(c.env, c.req.param('id'));
    if (!row) return c.json({ code: 404, message: 'DLQ entry not found', data: undefined }, 404);
    return c.json({ data: toView(row) });
  })
  // 立即扫描到期的 pending 死信（等价手动触发一次 cron 补偿）
  .post('/scan', async (c) => {
    const pending = await listPending(c.env, 50).catch(() => []);
    const rebuilt: string[] = [];
    for (const dlq of pending) {
      const r = await rebuildFromDlq(c.env, dlq).catch(() => ({ ok: false, newExecutionId: undefined, error: 'rebuild failed' }));
      if (r.ok && r.newExecutionId) rebuilt.push(r.newExecutionId);
    }
    return c.json({ data: { scanned: pending.length, rebuilt } });
  })
  // POST /rest/dead-letter/:id/retry —— 手动重试（重排 pending + 立即重建）
  .post('/:id/retry', async (c) => {
    const row = await getDlq(c.env, c.req.param('id'));
    if (!row) return c.json({ code: 404, message: 'DLQ entry not found', data: undefined }, 404);
    if (row.status === 'resolved') return c.json({ code: 409, message: '条目已解决，无需重试', data: undefined }, 409);
    await requeueDeadLetter(c.env, row.id);
    const r = await rebuildFromDlq(c.env, row).catch(() => ({ ok: false, newExecutionId: undefined, error: 'rebuild failed' }));
    if (!r.ok) return c.json({ data: undefined, code: 400, message: r.error ?? 'rebuild failed' }, 400);
    return c.json({ data: { ok: true, executionId: r.newExecutionId } });
  })
  // POST /rest/dead-letter/:id/resolve —— 人工确认解决（不重跑）
  .post('/:id/resolve', async (c) => {
    const row = await getDlq(c.env, c.req.param('id'));
    if (!row) return c.json({ code: 404, message: 'DLQ entry not found', data: undefined }, 404);
    await resolveDeadLetter(c.env, row.id);
    return c.json({ data: { ok: true } });
  });

async function getDlq(env: Env, id: string): Promise<any | null> {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;
  return withRetry(() => env.DB.prepare('SELECT * FROM dead_letter_queue WHERE id=?').bind(numeric).first<any>());
}

function toView(row: any): any {
  return {
    id: row.id,
    executionId: row.execution_id,
    workflowId: row.workflow_id,
    nodeName: row.node_name,
    nodeType: row.node_type,
    lastError: row.last_error,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    status: row.status,
    nextRetryAt: row.next_retry_at,
    nodeParameters: parseJson(row.node_parameters),
    lastInputData: parseJson(row.last_input_data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}