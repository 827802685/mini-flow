// auth: 登录 / owner 初始化
// 最小实现：单用户。login 成功写入 n8n-auth cookie。
import { Hono } from 'hono';
import type { Env } from '../types';

const OWNER_EMAIL = 'admin@localhost';
// 骨架阶段不做真实密码校验；生产应接入 Workers Secrets 校验。
const SECRET = 'mini-flow-demo-secret';

export const authRoutes = new Hono<{ Bindings: Env }>()
  // 首次 setup（可选）
  .post('/owner/setup', async (c) => {
    return c.json({ data: { user: { id: 'owner', email: OWNER_EMAIL, firstName: 'Admin', lastName: '', role: 'owner' } } });
  })
  // 登录
  .post('/login', async (c) => {
    return c.json({
      data: {
        id: 'owner', email: OWNER_EMAIL,
        firstName: 'Admin', lastName: '',
        role: 'owner',
        isOwner: true,
        isPending: false,
      },
    }, 200, {
      'Set-Cookie': `n8n-auth=${SECRET}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    });
  })
  // 注销
  .post('/logout', async (c) => c.json({ data: { loggedOut: true } }));