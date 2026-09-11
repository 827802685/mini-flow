// n8n REST 适配层 —— /rest/* 路由聚合
// 前端 editor-ui 通过 VUE_APP_URL_BASE_API 指向这里。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { authRoutes, isAuthed } from './auth';
import { settingsRoutes, userRoutes, userListRoutes, moduleSettingsRoutes } from './settings';
import { rolesRoutes, variablesRoutes } from './aux';
import { projectRoutes, createProject } from './projects';
import { credentialRoutes, credentialTypesHandler } from './credentials';
import { nodeTypeRoutes, nodeTypeDefs } from './node-types';
import { listPlugins } from '../plugins';
import { workflowRoutes } from './workflows';
import { executionRoutes } from './executions';
import { dlqRoutes } from './dead-letter';
import { templatesRoutes } from './templates';

const SETTINGS_KEY = 'user-settings';
async function readSettings(c: Context): Promise<Record<string, unknown>> {
  const env = c.env as Env;
  if (!env.CREDENTIALS) return {};
  const raw = await env.CREDENTIALS.get(SETTINGS_KEY, 'json').catch(() => null);
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

// strict: false —— 忽略路径尾部斜杠，确保前端访问 /rest/projects/ 与 /rest/projects
// 均命中同一 handler（Hono 默认 strict:true 会区分尾部斜杠，导致 POST /projects/ 404）
export const restApi = new Hono<{ Bindings: Env }>({ strict: false })

// 用户偏好设置：n8n 前端 settings.store 直接 PATCH /rest/me/settings（无 /user 段）。
// 缺失时工作流保存报 "Problem saving workflow" 404，故在此根挂载。
restApi
  .get('/me/settings', async (c) => {
    if (!isAuthed(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: await readSettings(c) });
  })
  .patch('/me/settings', async (c) => {
    if (!isAuthed(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const merged = { ...(await readSettings(c)), ...body };
    await (c.env.CREDENTIALS?.put(SETTINGS_KEY, JSON.stringify(merged))).catch(() => undefined);
    return c.json({ data: merged });
  })
  .get('/me/settings', async (c) => c.json({ data: await readSettings(c) }));

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

// 模板导入/编辑器会 POST /rest/webhooks/find 检索匹配的既有 webhook 以便复用。
// 本精简版无独立 webhook CRUD，返回空数组即可，避免 404。
restApi.post('/webhooks/find', async (c) => {
  if (!isAuthed(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
  return c.json({ data: [] });
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
  // 插件目录：/rest/plugins（社区插件 / 内置插件清单）
  .get('/plugins', (c) => c.json({ data: listPlugins() }))
  .route('/workflow-dependencies', workflowDependencyRoutes)
  .route('/projects', projectRoutes)
  // 创建项目：前端 POST /rest/projects 或 /rest/projects/ 均需命中。
  // Hono 的 .route(prefix, subapp) 挂载对空路径 POST 不归一化尾部斜杠，
  // 故在根 restApi 显式注册两种形态，统一走 createProject。
  .post('/projects', (c) => createProject(c))
  .post('/projects/', (c) => createProject(c))
  .route('/workflows', workflowRoutes)
  .route('/executions', executionRoutes)
  .route('/dead-letter', dlqRoutes)
  .route('/templates', templatesRoutes)
  .route('/roles', rolesRoutes)
  .route('/variables', variablesRoutes)
  // 凭据：/credentials CRUD + /credential-types。原 /credentials 只有空的 for-workflow/types，
  // 现由凭据子系统统一承载，避免编辑器凭据面板空/灰。
  .route('/credentials', credentialRoutes)
  // 凭据类型：editor 初始化 fetchCredentialTypes GET /rest/credential-types（单数，独立路由）
  .get('/credential-types', credentialTypesHandler)
  // home project：editor projects.store 启动时读取，提供个人项目
  .get('/home/project', async (c) => {
    try {
      const p = await c.env.DB.prepare("SELECT id,name,type,created_at FROM projects WHERE id='personal'").first<{ id: string }>();
      return c.json({ data: p ? { id: p.id, name: 'Personal', icon: null } : null });
    } catch { return c.json({ data: null }); }
  })
  // meta：实例元信息
  .get('/meta', (c) => c.json({ data: { instanceId: 'mini-flow-instance', instanceMeta: {} } }))
  // community-nodes：社区节点清单（空）
  .get('/community-nodes', (c) => c.json({ data: [] }))
  // tags：工作流标签
  .get('/tags', (c) => c.json({ data: [] }))
  // 节点翻译头：defaultLocale 非 en 时路由守卫调用 getNodeTranslationHeaders
  // （GET /rest/node-translation-headers）。本精简版无节点翻译，返回空映射即可，
  // 缺失时前端 localizeNodeName 回退英文节点名。
  .get('/node-translation-headers', (c) => c.json({ data: {} }))
  // 凭据翻译：defaultLocale 非 en 时凭据面板按类型请求翻译。返回 null 表示无翻译。
  .get('/credential-translation', (c) => c.json({ data: null }))
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