// n8n REST 适配层 —— /rest/* 路由聚合
// 前端 editor-ui 通过 VUE_APP_URL_BASE_API 指向这里。
import { Hono } from 'hono';
import type { Env } from '../types';
import { authRoutes } from './auth';
import { settingsRoutes, userRoutes, userListRoutes, moduleSettingsRoutes } from './settings';
import { rolesRoutes, variablesRoutes, credentialsAuxRoutes } from './aux';
import { projectRoutes } from './projects';
import { nodeTypeRoutes, nodeTypeDefs } from './node-types';
import { workflowRoutes } from './workflows';
import { executionRoutes } from './executions';
import { dlqRoutes } from './dead-letter';

export const restApi = new Hono<{ Bindings: Env }>()

// 会话列表 + 节点目录：独立子应用（Hono .route() 必须接收子应用而非函数）
const sessionsRoutes = new Hono<{ Bindings: Env }>()
  .get('/', (c) => c.json({ data: [] }));
const nodesRoutes = new Hono<{ Bindings: Env }>()
  .get('/', (c) => c.json({ data: nodeTypeDefs() }));
// 依赖计数/详情：前端 DependencyPill 用于展示工作流被多少对象引用。
// 本精简版无第三方依赖，返回空映射即可（避免 404 引发 console 报错）。
const workflowDependencyRoutes = new Hono<{ Bindings: Env }>()
  .post('/counts', async (c) => {
    const body = await c.req.json<{ resourceIds?: string[] }>().catch(() => ({ resourceIds: [] as string[] }));
    const out: Record<string, Record<string, number>> = {};
    for (const id of body.resourceIds ?? []) out[id] = {};
    return c.json(out);
  })
  .post('/details', async (c) => {
    const body = await c.req.json<{ resourceIds?: string[] }>().catch(() => ({ resourceIds: [] as string[] }));
    const out: Record<string, { dependencies: unknown[]; inaccessibleCount: number }> = {};
    for (const id of body.resourceIds ?? []) out[id] = { dependencies: [], inaccessibleCount: 0 };
    return c.json(out);
  });

restApi
  .route('/settings', settingsRoutes)
  .route('/', authRoutes)      // login / owner/setup（挂根即可，路径内再判）
  .route('/module-settings', moduleSettingsRoutes)
  .route('/user', userRoutes)   // n8n 用单数：/rest/user/me
  .route('/users', userListRoutes) // 复数：/rest/users（用户列表，侧边栏）
  .route('/sessions', sessionsRoutes)
  .route('/nodes', nodesRoutes)
  .route('/node-types', nodeTypeRoutes)
  .route('/workflow-dependencies', workflowDependencyRoutes)
  .route('/projects', projectRoutes)
  .route('/workflows', workflowRoutes)
  .route('/executions', executionRoutes)
  .route('/dead-letter', dlqRoutes)
  .route('/roles', rolesRoutes)
  .route('/variables', variablesRoutes)
  .route('/credentials', credentialsAuxRoutes)
  // 动态端点：角色/项目等信息由上面提供
  // 仪表盘展示激活状态：GET /rest/active-workflows
  .get('/active-workflows', async (c) => {
    try {
      const res = await c.env.DB.prepare('SELECT id, name, active FROM workflows WHERE active=1')
        .all<{ id: string; name: string; active: number }>();
      return c.json({ data: (res.results ?? []).map((r) => ({ id: r.id, name: r.name, active: !!r.active })) });
    } catch {
      return c.json({ data: [] });
    }
  });

// n8n 返回统一包裹 { data, ... }，错误用 HTTP 状态 + { code, message }
export function wrap(data: unknown) {
  return { data };
}

export function error(status: number, message: string, code = status) {
  return { status, json: { code, message } };
}