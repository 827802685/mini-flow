// projects: n8n 项目（Projects）相关 REST
// Personal 个人项目落库；支持创建/查询团队(team)项目。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { withRetry } from '../engine/retry';

export interface ProjectRow {
  id: string;
  name: string;
  type: string;
  created_at: string;
}

const PROJECT_SCOPES = [
  'project:read', 'project:update', 'project:delete',
  'workflow:create', 'workflow:read', 'workflow:update', 'workflow:delete',
  'workflow:list', 'workflow:move', 'workflow:execute',
  'workflow:share', 'workflow:activate',
  'credential:create', 'credential:read', 'credential:update', 'credential:delete', 'credential:list',
  'folder:create', 'folder:read', 'folder:update', 'folder:delete',
];

// 无条件确保 Personal 项目存在（幂等）
async function ensurePersonal(env: Env) {
  await withRetry(() => env.DB.prepare(
    "INSERT INTO projects (id, name, type) VALUES ('personal','Personal','personal') ON CONFLICT(id) DO NOTHING",
  ).run()).catch(() => undefined);
}

async function listProjects(env: Env): Promise<ProjectRow[]> {
  await ensurePersonal(env);
  const res = await withRetry(() => env.DB.prepare(
    "SELECT id, name, type, created_at FROM projects ORDER BY CASE type WHEN 'personal' THEN 0 ELSE 1 END, created_at",
  ).all<ProjectRow>());
  return res.results ?? [];
}

function toProject(p: ProjectRow) {
  return {
    id: p.id, name: p.name, type: p.type, icon: null as string | null,
    description: '', relations: [], scopes: PROJECT_SCOPES,
    createdAt: p.created_at, updatedAt: p.created_at,
  };
}

// 新建团队项目（POST /projects 与 /projects/ 共用）
export async function createProject(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ name?: string; type?: string }>().catch(() => ({ name: undefined, type: undefined }));
  const name = (body?.name ?? '').trim() || 'My project';
  const type = body?.type === 'personal' ? 'personal' : 'team';
  const id = crypto.randomUUID();
  await withRetry(() => c.env.DB.prepare(
    "INSERT INTO projects (id, name, type) VALUES (?,?,?)",
  ).bind(id, name, type).run());
  const created: ProjectRow = { id, name, type, created_at: new Date().toISOString() };
  return c.json({ data: toProject(created) }, 201);
}

export const projectRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  // 全部项目
  .get('/', async (c) => c.json({ data: (await listProjects(c.env)).map(toProject) }))
  // 我成员的项目
  .get('/my-projects', async (c) => c.json({ data: (await listProjects(c.env)).map(toProject) }))
  // 个人项目
  .get('/personal', async (c) => {
    await ensurePersonal(c.env);
    const p = await withRetry(() => c.env.DB.prepare("SELECT id,name,type,created_at FROM projects WHERE id='personal'").first<ProjectRow>());
    return c.json({ data: p ? toProject(p) : null });
  })
  // 项目计数：n8n 前端按 {personal, team, public} 读取
  .get('/count', async (c) => {
    const all = await listProjects(c.env);
    const team = all.filter((p) => p.type !== 'personal').length;
    return c.json({ data: { personal: 1, team, public: 0 } });
  })
  // 单个项目
  .get('/:id', async (c) => {
    const p = await withRetry(() => c.env.DB.prepare("SELECT id,name,type,created_at FROM projects WHERE id=?").bind(c.req.param('id')).first<ProjectRow>());
    if (!p) return c.json({ code: 404, message: 'Project not found', data: undefined }, 404);
    return c.json({ data: toProject(p) });
  })
  // 重命名
  .patch('/:id', async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
    await withRetry(() => c.env.DB.prepare("UPDATE projects SET name=? WHERE id=?").bind((body?.name ?? '').trim() || 'Project', c.req.param('id')).run());
    const p = await withRetry(() => c.env.DB.prepare("SELECT id,name,type,created_at FROM projects WHERE id=?").bind(c.req.param('id')).first<ProjectRow>());
    return c.json({ data: p ? toProject(p) : null });
  })
  // 删除团队项目（Personal 不允许删）
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (id === 'personal') return c.json({ code: 400, message: 'Cannot delete personal project', data: undefined }, 400);
    await withRetry(() => c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run());
    return c.json({ data: { success: true } });
  });