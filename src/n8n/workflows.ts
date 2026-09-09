// workflows: n8n REST CRUD（D1 持久化 n8n 原生 workflow JSON）
import { Hono } from 'hono';
import type { Env, N8nWorkflow } from '../types';
import { withRetry } from '../engine/retry';
import { parseWorkflowRow, type WorkflowRow } from '../db/schema';
import { startExecution } from '../engine/executor';
import { sendPush } from './push';

export const workflowRoutes = new Hono<{ Bindings: Env }>()
  .get('/', async (c) => {
    const res = await withRetry(() => c.env.DB.prepare('SELECT id, name, active, settings, updated_at, created_at FROM workflows ORDER BY updated_at DESC').all<WorkflowRow>());
    const rows = res.results.map((r) => ({ id: r.id, name: r.name, active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at, tags: [] }));
    return c.json({ data: rows });
  })
  .post('/', async (c) => {
    const body = await c.req.json<N8nWorkflow>();
    // 优先采用前端回传的 id（新建工作流 URL 用该 short-id，刷新时用同一 id 取回）；
    // 无 id 才生成 UUID，保证客户端/服务端 id 一致。
    const id = body.id ?? crypto.randomUUID();
    await withRetry(() => c.env.DB.prepare(
      "INSERT INTO workflows (id, name, nodes, connections, settings) VALUES (?,?,?,?,?)",
    ).bind(id, body.name, JSON.stringify(body.nodes ?? []), JSON.stringify(body.connections ?? {}), body.settings ? JSON.stringify(body.settings) : null).run());
    return c.json({ data: { id, name: body.name, nodes: body.nodes ?? [], connections: body.connections ?? {}, settings: body.settings, active: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }, 201);
  })
  .get('/:id/exists', async (c) => {
    const id = c.req.param('id');
    const row = await withRetry(() => c.env.DB.prepare('SELECT id FROM workflows WHERE id=?').bind(id).first<WorkflowRow>());
    return c.json({ data: !!row });
  })
  .get('/:id', async (c) => withWorkflow(c.env, c.req.param('id'), async (wf) => c.json({ data: toResponse(wf) }), () => missingWorkflow(c.req.param('id'))))
  .patch('/:id', async (c) => withWorkflow(c.env, c.req.param('id'), async (wf, row) => {
    const body = await c.req.json<N8nWorkflow>();
    await withRetry(() => c.env.DB.prepare(
      "UPDATE workflows SET name=?, nodes=?, connections=?, settings=?, updated_at=datetime('now') WHERE id=?",
    ).bind(body.name ?? wf.name, JSON.stringify(body.nodes ?? row.nodes), JSON.stringify(body.connections ?? row.connections), body.settings ? JSON.stringify(body.settings) : row.settings, wf.id).run());
    return c.json({ data: toResponse({ ...wf, ...body, nodes: body.nodes ?? wf.nodes, connections: body.connections ?? wf.connections }) });
  }, () => missingWorkflow(c.req.param('id'))))
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    // 先删依赖子表（node_executions 有 FK 指向 executions；executions/dead_letter 指向 workflows），
    // 否则 DELETE workflows 触发外键约束报 500。
    await withRetry(() => c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM node_executions WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id=?)').bind(id),
      c.env.DB.prepare('DELETE FROM dead_letter_queue WHERE workflow_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM executions WHERE workflow_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM workflows WHERE id=?').bind(id),
    ]));
    return c.json({ data: { success: true } });
  })
  // 查询包含指定节点类型的工作流：POST /rest/workflows/with-node-types
  // 前端 getWorkflowsWithNodesIncluded 用 nodeTypes 过滤返回 WorkflowResource[]。
  // 必须注册在 /:id 之前，否则 with-node-types 会被当成 id 捕获。
  .post('/with-node-types', async (c) => {
    const body = await c.req.json<{ nodeTypes?: string[] }>().catch(() => ({ nodeTypes: [] }));
    const want = new Set<string>(body?.nodeTypes ?? []);
    const res = await withRetry(() => c.env.DB.prepare('SELECT id, name, nodes FROM workflows').all<WorkflowRow>());
    const matched = (res.results ?? []).filter((r) => {
      if (want.size === 0) return false;
      let nodes: unknown[] = [];
      try { nodes = JSON.parse(r.nodes ?? '[]'); } catch { /* ignore */ }
      return nodes.some((n: any) => n && typeof n.type === 'string' && want.has(n.type));
    }).map((r) => ({ id: r.id, name: r.name, nodes: safeParse(r.nodes) }));
    return c.json({ data: matched });
  })
  // 手动执行：POST /rest/workflows/:id/run
  .post('/:id/run', async (c) => withWorkflow(c.env, c.req.param('id'), async (wf) => {
    const body = await c.req.json<{ data?: unknown }>().catch(() => ({ data: undefined }));
    const outcome = await startExecution(c.env, wf, body?.data ?? body, 'manual', (e) => sendPush(c.env, e));
    if (!outcome.ok) return c.json({ data: undefined, code: 409, message: outcome.error }, 409);
    return c.json({ data: { executionId: outcome.executionId } });
  }, () => missingWorkflow(c.req.param('id'))))
  // 激活/停用（骨架：仅置 active 位，记录型）
  .post('/:id/activate', async (c) => setActive(c.env, c.req.param('id'), 1, c))
  .post('/:id/deactivate', async (c) => setActive(c.env, c.req.param('id'), 0, c));

async function setActive(env: Env, id: string, active: number, c: { json: any }) {
  await withRetry(() => env.DB.prepare("UPDATE workflows SET active=?, updated_at=datetime('now') WHERE id=?").bind(active, id).run());
  return c.json({ data: { success: true } });
}

async function withWorkflow(
  env: Env,
  id: string,
  handler: (wf: N8nWorkflow, row: WorkflowRow) => Promise<Response>,
  notFound: () => Response,
): Promise<Response> {
  const row = await withRetry(() => env.DB.prepare('SELECT * FROM workflows WHERE id=?').bind(id).first<WorkflowRow>());
  if (!row) return notFound();
  const wf = parseWorkflowRow(row);
  return handler(wf, row);
}

function missingWorkflow(id: string): Response {
  return new Response(JSON.stringify({ code: 404, message: `Workflow not found ${id}`, data: undefined }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
}

function toResponse(wf: N8nWorkflow) {
  return {
    id: wf.id, name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings,
    active: !!wf.active, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [],
  };
}

function safeParse(json: string | null): unknown[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}