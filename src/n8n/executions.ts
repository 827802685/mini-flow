// executions: 执行列表/详情/resume（n8n REST）
import { Hono } from 'hono';
import type { Env } from '../types';
import { withRetry } from '../engine/retry';
import { parseWorkflowRow, type ExecutionRow, type WorkflowRow } from '../db/schema';

export const executionRoutes = new Hono<{ Bindings: Env }>()
  // DEBUG: 仅本地诊断 —— 返回原始执行行 + 节点执行日志，用于排查引擎是否真正跑起来
  .get('/_debug/:id/raw', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM executions WHERE id=?').bind(id).first<ExecutionRow>().catch(() => null);
    const logs = await c.env.DB.prepare('SELECT node_name, node_type, status, retry_attempt, error_message, output_data, started_at, finished_at FROM node_executions WHERE execution_id=?').bind(id).all().catch(() => ({ results: [] }));
    return c.json({ data: { row, nodeLogs: logs.results } });
  })
  // POST /rest/executions/:id/stop —— 停止运行中的执行（前端 Execute 界面 Stop 按钮）
  .post('/:id/stop', async (c) => {
    const id = c.req.param('id');
    const r = await withRetry(() => c.env.DB.prepare('SELECT * FROM executions WHERE id=?').bind(id).first<ExecutionRow>());
    if (!r) return c.json({ code: 404, message: 'Execution not found', data: undefined }, 404);
    // 仅 running/pending/queued 可停止
    if (r.status !== 'running' && r.status !== 'pending') {
      return c.json({ data: { id, stopped: false, status: r.status } });
    }
    await withRetry(() => c.env.DB.prepare(
      "UPDATE executions SET status='cancelled', finished_at=datetime('now'), error_message=? WHERE id=?",
    ).bind('Execution stopped by user', id).run());
    return c.json({ data: { id, stopped: true, status: 'cancelled' } });
  })
  .get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(100, Number(q.limit ?? 20));
    const offset = Math.max(0, Number(q.offset ?? 0));
    const wf = q.workflowId ? String(q.workflowId) : null;
    // n8n 前端执行列表读取 response.data.results（同时用 count/finished/running），
    // 且工作流执行页会带 workflowId 过滤 —— 两者都必须支持，否则前端显示"No executions"。
    const where = wf ? ' WHERE workflow_id=?' : '';
    const base: (string | number)[] = wf ? [wf] : [];
    const total = (await withRetry(() => c.env.DB.prepare(`SELECT COUNT(*) AS c FROM executions${where}`).bind(...base).first<{ c: number }>()))?.c ?? 0;
    const qRes = await withRetry(() => c.env.DB.prepare(
      `SELECT * FROM executions${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    ).bind(...base, limit, offset).all<ExecutionRow>());
    const data = await Promise.all(qRes.results.map(async (r) => {
      const wrow = await c.env.DB.prepare('SELECT name FROM workflows WHERE id=?').bind(r.workflow_id).first<{ name: string }>();
      return {
        id: r.id, workflowId: r.workflow_id, workflowName: wrow?.name ?? r.workflow_id,
        status: rst(r.status), mode: r.mode ?? 'manual', finished: !!r.finished_at,
        startedAt: r.started_at, stoppedAt: r.finished_at, retryCount: r.retry_count,
      };
    }));
    const finished = data.filter((d) => d.finished).length;
    const running = data.filter((d) => !d.finished).length;
    return c.json({ data: { count: total, finished, running, results: data } });
  })
  .get('/:id', async (c) => {
    const r = await withRetry(() => c.env.DB.prepare('SELECT * FROM executions WHERE id=?').bind(c.req.param('id')).first<ExecutionRow>());
    if (!r) return c.json({ code: 404, message: 'Execution not found', data: undefined }, 404);
    const wf = await c.env.DB.prepare('SELECT name FROM workflows WHERE id=?').bind(r.workflow_id).first<{ name: string }>();
    return c.json({ data: executionDetail(r, wf?.name) });
  })
  // POST /rest/executions/:id/resume —— 从检查点恢复一个 paused 的执行
  .post('/:id/resume', async (c) => {
    const id = c.req.param('id');
    const r = await withRetry(() => c.env.DB.prepare('SELECT * FROM executions WHERE id=?').bind(id).first<ExecutionRow>());
    if (!r) return c.json({ code: 404, message: 'Execution not found', data: undefined }, 404);
    if (r.status !== 'paused') {
      return c.json({ code: 409, message: `execution is ${r.status}, only paused can be resumed`, data: undefined }, 409);
    }
    const wf = await withRetry(() => c.env.DB.prepare('SELECT * FROM workflows WHERE id=?').bind(r.workflow_id).first<WorkflowRow>());
    if (!wf) return c.json({ code: 404, message: 'Workflow not found', data: undefined }, 404);
    const workflow = parseWorkflowRow(wf);

    // 从检查点抽取已完成节点 + 中间数据，作为续跑输入
    let completedNodes: string[] = [];
    let data: any = {};
    try {
      const cp = r.checkpoint ? JSON.parse(r.checkpoint) : null;
      completedNodes = cp?.completedNodes ?? [];
      data = cp?.data ?? {};
    } catch { /* 检查点损坏则从入口重跑 */ }

    // 复用原 execution id 重新提交 Workflows（原实例已终态，同 id 幂等）
    void c.env.FLOW_ENGINE.create({
      id,
      params: {
        workflowId: workflow.id as string,
        workflowName: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        executionId: id,
        mode: r.mode ?? 'manual',
        input: data,
        completedNodes,
      },
    });
    await withRetry(() => c.env.DB.prepare("UPDATE executions SET status='running' WHERE id=?").bind(id).run());
    return c.json({ data: { executionId: id, status: 'running', resumed: true } });
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