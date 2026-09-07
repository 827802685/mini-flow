// executions: 执行列表/详情（n8n REST）
import { Hono } from 'hono';
import type { Env } from '../types';
import { withRetry } from '../engine/retry';
import type { ExecutionRow } from '../db/schema';

export const executionRoutes = new Hono<{ Bindings: Env }>()
  .get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(100, Number(q.limit ?? 20));
    const res = await withRetry(() => c.env.DB.prepare(
      'SELECT * FROM executions ORDER BY started_at DESC LIMIT ?',
    ).bind(limit).all<ExecutionRow>());
    // n8n 列表需要 id + 关联 workflow 信息的最小形态
    const data = await Promise.all(res.results.map(async (r) => {
      const wf = await c.env.DB.prepare('SELECT name FROM workflows WHERE id=?').bind(r.workflow_id).first<{ name: string }>();
      return {
        id: r.id, workflowId: r.workflow_id, workflowName: wf?.name ?? r.workflow_id,
        status: rst(r.status), mode: r.mode ?? 'manual', finished: r.finished_at,
        startedAt: r.started_at, stoppedAt: r.finished_at, retryCount: r.retry_count,
      };
    }));
    return c.json({ data });
  })
  .get('/:id', async (c) => {
    const r = await withRetry(() => c.env.DB.prepare('SELECT * FROM executions WHERE id=?').bind(c.req.param('id')).first<ExecutionRow>());
    if (!r) return c.json({ code: 404, message: 'Execution not found', data: undefined }, 404);
    const wf = await c.env.DB.prepare('SELECT name FROM workflows WHERE id=?').bind(r.workflow_id).first<{ name: string }>();
    return c.json({ data: executionDetail(r, wf?.name) });
  });

function rst(s: ExecutionRow['status']): string {
  // n8n 状态语义
  const map: Record<string, string> = { pending: 'queued', running: 'running', paused: 'waiting', completed: 'success', failed: 'error', cancelled: 'cancelled' };
  return map[s] ?? s;
}

function executionDetail(r: ExecutionRow, wfName?: string) {
  let data: any = {};
  try { data = r.output_data ? JSON.parse(r.output_data) : {}; } catch { /* ignore */ }
  return {
    id: r.id, workflowId: r.workflow_id, workflowName: wfName ?? r.workflow_id,
    status: rst(r.status), mode: r.mode ?? 'manual',
    startedAt: r.started_at, stoppedAt: r.finished_at, finished: r.finished_at,
    data: r.status === 'completed' ? { main: data } : undefined,
    outputData: r.status === 'completed' ? data : undefined,
    error: r.error_message ? { message: r.error_message } : undefined,
    retryCount: r.retry_count,
  };
}