// workflows: n8n REST CRUD（D1 持久化 n8n 原生 workflow JSON）
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, N8nWorkflow } from '../types';
import { withRetry } from '../engine/retry';
import { parseWorkflowRow, type WorkflowRow } from '../db/schema';
import { startExecution } from '../engine/executor';
import { sendPush } from './push';

export const workflowRoutes = new Hono<{ Bindings: Env }>()
  .get('/', async (c) => {
    const projectId = c.req.query('projectId');
    let sql = 'SELECT id, name, active, settings, updated_at, created_at, project_id FROM workflows';
    const binds: string[] = [];
    if (projectId) { sql += ' WHERE project_id=?'; binds.push(projectId); }
    sql += ' ORDER BY updated_at DESC';
    const res = await withRetry(() => c.env.DB.prepare(sql).bind(...binds).all<WorkflowRow>());
    const rows = res.results.map((r) => ({ id: r.id, name: r.name, active: !!r.active, projectId: (r as any).project_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at, tags: [] }));
    return c.json({ data: rows });
  })
  .get('/new', async (c) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    return c.json({ data: { id, name: 'Untitled workflow', nodes: [], connections: {}, active: false, settings: {}, projectId: null, createdAt: now, updatedAt: now } });
  })
  // 前端在创建新工作流时 POST /workflows/new 取得默认工作流与 id（Vue route 预取）。
  // 与 GET 等价；enabled:true 标记该 id 可编辑，前端据此进入画布。
  .post('/new', (c) => newWorkflowHandler(c))
  .post('/', async (c) => {
    const body = await c.req.json<N8nWorkflow>();
    // 优先采用前端回传的 id（新建工作流 URL 用该 short-id，刷新时用同一 id 取回）；
    // 无 id 才生成 UUID，保证客户端/服务端 id 一致。
    const id = body.id ?? crypto.randomUUID();
    const projectId = (body as any).projectId ?? null;
    // 用 upsert（ON CONFLICT DO UPDATE）：模板导入/自动保存时 n8n 会用同一 id 再次 POST，
    // 若走纯 INSERT 会因 UNIQUE 约束返回 500。改为幂等写入，重复 POST 即更新，不再报错。
    await withRetry(() => c.env.DB.prepare(
      "INSERT INTO workflows (id, name, nodes, connections, settings, project_id) VALUES (?,?,?,?,?,?) "
      + "ON CONFLICT(id) DO UPDATE SET "
      + "name=excluded.name, nodes=excluded.nodes, connections=excluded.connections, "
      + "settings=excluded.settings, project_id=excluded.project_id, updated_at=datetime('now')",
    ).bind(id, body.name, JSON.stringify(body.nodes ?? []), JSON.stringify(body.connections ?? {}), body.settings ? JSON.stringify(body.settings) : null, projectId).run());
    return c.json({ data: { id, name: body.name, nodes: body.nodes ?? [], connections: body.connections ?? {}, settings: body.settings, projectId, active: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }, 201);
  })
  .get('/:id/exists', async (c) => {
    const id = c.req.param('id');
    const row = await withRetry(() => c.env.DB.prepare('SELECT id FROM workflows WHERE id=?').bind(id).first<WorkflowRow>());
    return c.json({ data: !!row });
  })
  .get('/:id', async (c) => withWorkflow(c.env, c.req.param('id'), async (wf) => c.json({ data: toResponse(wf) }), () => missingWorkflow(c.req.param('id'))))
  // PUT /:id：n8n 编辑器保存更新工作流常发 PUT（部分 Flow 走 PATCH）。语义与 PATCH 一致，做全量更新。
  .put('/:id', async (c) => updateWorkflowHandler(c, c.req.param('id')))
  .patch('/:id', async (c) => updateWorkflowHandler(c, c.req.param('id')))
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

// 新建/默认工作流（POST /workflows/new）：返回带新 id 的空工作流。
// 前端在创建新工作流时 POST /workflows/new 预先取得 id，body 可携带 projectId。
export async function newWorkflowHandler(c: Context<{ Bindings: Env }>) {
  let projectId: string | null = null;
  try {
    const body = await c.req.json<{ projectId?: string | null }>();
    projectId = body?.projectId ?? null;
  } catch { /* 空 body 或无 JSON → 忽略，用 null */ }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return c.json({ data: { id, name: 'Untitled workflow', nodes: [], connections: {}, active: false, settings: {}, projectId, enabled: true, createdAt: now, updatedAt: now } });
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

// 更新工作流（PUT 与 PATCH 共用）：按 body 全量/局部更新 name/nodes/connections/settings/project_id。
async function updateWorkflowHandler(c: Context<{ Bindings: Env }>, id: string) {
  return withWorkflow(c.env, id, async (wf, row) => {
    const body = await c.req.json<N8nWorkflow>();
    let sql = "UPDATE workflows SET name=?, nodes=?, connections=?, settings=?, updated_at=datetime('now')";
    const vals: (string | number | null)[] = [body.name ?? wf.name, JSON.stringify(body.nodes ?? row.nodes), JSON.stringify(body.connections ?? row.connections), body.settings ? JSON.stringify(body.settings) : row.settings];
    const rawProj = (body as any).projectId as string | null | undefined;
    const proj: string | null | undefined = rawProj === undefined ? undefined : (rawProj === null ? null : String(rawProj));
    if (proj !== undefined) { sql += ', project_id=?'; vals.push(proj as string | null); }
    sql += ' WHERE id=?'; vals.push(id);
    await withRetry(() => c.env.DB.prepare(sql).bind(...vals).run());
    const merged = { ...wf, ...body, nodes: body.nodes ?? wf.nodes, connections: body.connections ?? wf.connections } as any;
    if (proj !== undefined) merged.projectId = proj;
    return c.json({ data: toResponse(merged) });
  }, () => missingWorkflow(id));
}

function missingWorkflow(id: string): Response {
  return new Response(JSON.stringify({ code: 404, message: `Workflow not found ${id}`, data: undefined }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
}

function toResponse(wf: N8nWorkflow) {
  return {
    id: wf.id, name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings,
    projectId: (wf as any).projectId ?? null,
    active: !!wf.active, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [],
  };
}

function safeParse(json: string | null): unknown[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}