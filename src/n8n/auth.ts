// auth: 登录 / owner 初始化
// 最小实现：单用户。login 成功写入 n8n-auth cookie。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';

const OWNER_EMAIL = 'admin@example.com';
// 骨架阶段不做真实密码校验；生产应接入 Workers Secrets 校验。
export const COOKIE_NAME = 'n8n-auth';
const SECRET = 'mini-flow-demo-secret';

// 会话判定：请求携带正确的 n8n-auth cookie 才算已登录
export function isAuthed(c: Context<{ Bindings: Env }>): boolean {
  const h = c.req.header('cookie') ?? '';
  return h.includes(`${COOKIE_NAME}=${SECRET}`);
}

export function owner() {
  return {
    id: 'owner', email: OWNER_EMAIL, firstName: 'Admin', lastName: '',
    role: 'owner', isOwner: true, isPending: false,
    globalScopes: [
      'global:owner',
      'user:read', 'user:update', 'user:invite', 'user:list', 'user:delete',
      'workflow:create', 'workflow:read', 'workflow:update', 'workflow:delete',
      'workflow:list', 'workflow:move', 'workflow:execute', 'workflow:share', 'workflow:activate',
      'credential:create', 'credential:read', 'credential:update', 'credential:delete', 'credential:list', 'credential:share',
      'project:create', 'project:read', 'project:update', 'project:delete', 'project:list',
      'folder:create', 'folder:read', 'folder:update', 'folder:delete',
      'insights:list', 'auditLogs:manage', 'variables:create', 'variables:read', 'variables:update', 'variables:delete',
    ],
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
      'Set-Cookie': `${COOKIE_NAME}=${SECRET}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    });
  })
  // 注销
  .post('/logout', async (c) => c.json({ data: { loggedOut: true } }));