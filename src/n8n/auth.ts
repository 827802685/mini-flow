// auth: 登录 / owner 初始化
// 最小实现：单用户。login 成功写入 n8n-auth cookie。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';

const OWNER_EMAIL = 'admin@example.com';
// 骨架阶段不做真实密码校验；生产应接入 Workers Secrets 校验。
export const COOKIE_NAME = 'n8n-auth';
const SECRET = 'mini-flow-demo-secret';

// 单用户=owner 的全局权限：既有 globalScopes 也有顶层 scopes，
// 关键在 owner 返回时同时给出，前端 currentUser.scopes / workflow.scopes 据此判定 workflowPermissions.update 等。
// 缺任一都会让节点编辑操作（删除/替换/停用/固定/执行步骤）被判定为不可编辑而置灰。
export const OWNER_SCOPES: string[] = [
  'global:owner',
  'user:read', 'user:update', 'user:invite', 'user:list', 'user:delete',
  'workflow:create', 'workflow:read', 'workflow:update', 'workflow:delete',
  'workflow:list', 'workflow:move', 'workflow:execute', 'workflow:share', 'workflow:activate',
  'credential:create', 'credential:read', 'credential:update', 'credential:delete', 'credential:list', 'credential:share',
  'project:create', 'project:read', 'project:update', 'project:delete', 'project:list',
  'folder:create', 'folder:read', 'folder:update', 'folder:delete',
  'insights:list', 'auditLogs:manage',
  'variables:create', 'variables:read', 'variables:update', 'variables:delete',
  'variable:create', 'variable:read', 'variable:update', 'variable:delete', 'variable:share', 'variable:list',
];

// cookie 有效期：30 天，同设备二次访问不再弹出登录验证
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// 会话判定：请求携带正确的 n8n-auth cookie 才算已登录
export function isAuthed(c: Context<{ Bindings: Env }>): boolean {
  const h = c.req.header('cookie') ?? '';
  return h.includes(`${COOKIE_NAME}=${SECRET}`);
}

export function owner() {
  return {
    id: 'owner', email: OWNER_EMAIL, firstName: 'Admin', lastName: '',
    role: 'owner', isOwner: true, isPending: false,
    globalScopes: OWNER_SCOPES,
    // 前端(currentUser.scopes)用它计算 workflowPermissions.update 等：
    //   节点右键/三点菜单里"删除/替换/停用/固定/执行步骤"是否可点，均取决于此。
    scopes: OWNER_SCOPES,
    features: {
      usersCreate: true, usersRead: true, usersUpdate: true,
      smtp: {}, users: {},
    },
  };
}

export const authRoutes = new Hono<{ Bindings: Env }>()
  // 首次 setup（可选）
  .post('/owner/setup', async (c) => {
    return c.json({ data: { user: owner() } });
  })
  // 当前 owner：editor-ui 启动时 GET /rest/owner 读取实例 owner 信息（用户菜单/owner 判定）。
  // 此前缺失 → SPA 回退返回 index.html，前端 fetch 解析失败。补齐为 n8n 契约形状。
  .get('/owner', (c) => {
    if (!isAuthed(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: owner() });
  })
  // 登录
  .post('/login', async (c) => {
    return c.json({ data: owner() }, 200, {
      'Set-Cookie': `${COOKIE_NAME}=${SECRET}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
    });
  })
  // 登录态探测：editor-ui 启动时 GET /rest/login 判断是否已登录。
  // 此前缺失 → 落到 SPA fallback 返回 200 HTML，前端解析失败始终判定未登录，
  // 导致同一设备二次访问仍弹出登录验证。已登录返回当前用户，否则 401。
  .get('/login', (c) => {
    if (!isAuthed(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: owner() });
  })
  // 注销
  .post('/logout', async (c) => c.json({ data: { loggedOut: true } }));